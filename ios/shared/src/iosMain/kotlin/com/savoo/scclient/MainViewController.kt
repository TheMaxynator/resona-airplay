package com.savoo.scclient

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.window.ComposeUIViewController
import coil3.ImageLoader
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.network.ktor3.KtorNetworkFetcherFactory
import com.savoo.scclient.compat.AppContext
import com.savoo.scclient.compat.Strings
import com.savoo.scclient.compat.WebView
import com.savoo.scclient.data.remote.ClientIdProvider
import com.savoo.scclient.data.remote.WebViewApiBridge
import com.savoo.scclient.debug.ScreenshotModeInterceptor
import com.savoo.scclient.di.appModule
import com.savoo.scclient.player.AudioPlayer
import com.savoo.scclient.player.IosAudioPlayer
import com.savoo.scclient.player.PlayerController
import com.savoo.scclient.player.TVRemoteSession
import com.savoo.scclient.data.model.Track
import com.savoo.scclient.data.model.User
import platform.Foundation.NSNumber
import com.savoo.scclient.ui.navigation.TVConnectLauncher
import com.savoo.scclient.work.AutoExportManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.IO
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okio.Path.Companion.toPath
import org.koin.core.context.startKoin
import org.koin.dsl.module
import org.koin.mp.KoinPlatform
import platform.Foundation.NSLog
import platform.Foundation.NSNotificationCenter
import platform.Foundation.NSOperationQueue
import platform.darwin.NSObjectProtocol
import platform.UIKit.UIApplication
import platform.UIKit.UIViewController

private val iosModule = module {
    single<AudioPlayer> { IosAudioPlayer(get()) }
}

private var started = false
private var bridgeWebView: WebView? = null
private var tvQueueObserver: NSObjectProtocol? = null
private var tvStateObserver: NSObjectProtocol? = null
private var tvLocalObserver: NSObjectProtocol? = null

@OptIn(kotlin.experimental.ExperimentalNativeApi::class)
private fun installCrashLogger() {
    val previous = setUnhandledExceptionHook { e ->
        e.stackTraceToString().lineSequence().forEach { NSLog("ResonaCrash: %@", it) }
    }
    if (previous != null) setUnhandledExceptionHook { e ->
        e.stackTraceToString().lineSequence().forEach { NSLog("ResonaCrash: %@", it) }
        previous(e)
    }
}

private fun startApp() {
    if (started) return
    started = true
    installCrashLogger()
    startKoin { modules(appModule, iosModule) }
    SingletonImageLoader.setSafe { context ->
        ImageLoader.Builder(context)
            .components {
                add(ScreenshotModeInterceptor())
                add(KtorNetworkFetcherFactory())
            }
            .diskCache {
                DiskCache.Builder()
                    .directory("${AppContext.cacheDir.absolutePath}/image_cache".toPath())
                    .maxSizeBytes(64L * 1024 * 1024)
                    .build()
            }
            .build()
    }
    val koin = KoinPlatform.getKoin()
    TVConnectLauncher.open = {
        NSNotificationCenter.defaultCenter.postNotificationName("ResonaOpenTVSettings", null)
    }
    TVRemoteSession.send = { json ->
        NSNotificationCenter.defaultCenter.postNotificationName("ResonaTVRemoteCommand", null, mapOf<Any?, Any?>("json" to json))
    }
    tvStateObserver = NSNotificationCenter.defaultCenter.addObserverForName(
        "ResonaTVRemoteState", null, NSOperationQueue.mainQueue,
    ) { note -> (note?.userInfo?.get("json") as? String)?.let(TVRemoteSession::update) }
    tvLocalObserver = NSNotificationCenter.defaultCenter.addObserverForName(
        "ResonaTVReturnLocal", null, NSOperationQueue.mainQueue,
    ) { note ->
        val data = note?.userInfo ?: return@addObserverForName
        val source = (data["sourceId"] as? String)?.toLongOrNull() ?: return@addObserverForName
        val position = (data["position"] as? NSNumber)?.doubleValue ?: 0.0
        val track = Track(id = source, title = data["title"] as? String ?: "",
            user = User(username = data["artist"] as? String ?: ""), artworkUrl = data["artworkUrl"] as? String)
        TVRemoteSession.update("{\"active\":false}")
        koin.get<PlayerController>().playQueue(listOf(track), startExact = false, startPositionMs = (position.coerceAtLeast(0.0) * 1000).toLong())
    }
    tvQueueObserver = NSNotificationCenter.defaultCenter.addObserverForName(
        "ResonaTVQueueRequest", null, NSOperationQueue.mainQueue,
    ) { note ->
        val input = note?.userInfo ?: return@addObserverForName
        val requestId = input["requestId"] as? String ?: return@addObserverForName
        val sourceId = input["sourceId"] as? String ?: return@addObserverForName
        val streamUrl = input["streamUrl"] as? String ?: return@addObserverForName
        CoroutineScope(SupervisorJob() + Dispatchers.Main).launch {
            val response = mutableMapOf<Any?, Any?>("requestId" to requestId)
            try { response["json"] = koin.get<PlayerController>().prepareTVQueue(sourceId, streamUrl) }
            catch (_: Exception) { response["error"] = "The queue could not be prepared. Keep Resona open, check the connection and send again." }
            NSNotificationCenter.defaultCenter.postNotificationName("ResonaTVQueueReply", null, response)
        }
    }
    CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
        val provider = koin.get<ClientIdProvider>()
        if (provider.cachedOrFallback().isBlank()) provider.refresh()
    }
    koin.get<PlayerController>()
    CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
        val autoExport = koin.get<AutoExportManager>()
        autoExport.catchUpIfDue()
        autoExport.syncSchedule()
    }
}

private fun attachBridgeWebView() {
    if (bridgeWebView != null) return
    val window = UIApplication.sharedApplication.keyWindow ?: return
    val webView = WebView(AppContext)
    webView.alpha = 0f
    KoinPlatform.getKoin().get<WebViewApiBridge>().setWebView(webView)
    window.addSubview(webView.wk)
    bridgeWebView = webView
}

fun MainViewController(): UIViewController {
    startApp()
    return ComposeUIViewController {
        var ready by remember { mutableStateOf(Strings.loaded) }
        LaunchedEffect(Unit) {
            if (!ready) {
                Strings.preload()
                ready = true
            }
            attachBridgeWebView()
        }
        if (ready) {
            ResonaApp()
        } else {
            Box(Modifier.fillMaxSize().background(if (isSystemInDarkTheme()) Color.Black else Color.White))
        }
    }
}

fun onAppBackground() {
    val koin = KoinPlatform.getKoinOrNull() ?: return
    koin.getOrNull<PlayerController>()?.saveState()
    CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
        koin.getOrNull<AutoExportManager>()?.catchUpIfDue()
    }
}

fun runBackgroundExport(onDone: (Boolean) -> Unit) {
    startApp()
    CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
        val autoExport = KoinPlatform.getKoin().get<AutoExportManager>()
        val ok = runCatching { autoExport.catchUpIfDue() }.isSuccess
        runCatching { autoExport.syncSchedule() }
        onDone(ok)
    }
}
