package com.savoo.scclient.ui.screens.player

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.savoo.scclient.player.PlaybackState
import com.savoo.scclient.player.PlayerController
import com.savoo.scclient.player.TVRemoteSession
import com.savoo.scclient.resources.*
import com.savoo.scclient.ui.components.TrackArtwork
import com.savoo.scclient.ui.navigation.TVConnectLauncher
import org.jetbrains.compose.resources.stringResource

@Composable
internal fun TVRemotePlayer(state: PlaybackState, controller: PlayerController, onDismiss: () -> Unit) {
    var showQueue by remember { mutableStateOf(false) }
    var dragging by remember { mutableStateOf(false) }
    var position by remember { mutableFloatStateOf(state.positionMs.toFloat()) }
    LaunchedEffect(state.positionMs, state.currentTrack?.id) { if (!dragging) position = state.positionMs.toFloat() }
    val track = state.currentTrack ?: return
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onDismiss) { Icon(Icons.Default.KeyboardArrowDown, stringResource(Res.string.tv_remote_close)) }
            Text(stringResource(if (state.remoteOnline) Res.string.tv_remote_playing else Res.string.tv_remote_connecting),
                modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, textAlign = TextAlign.Center)
            IconButton(onClick = { TVConnectLauncher.open?.invoke() }) { Icon(Icons.Default.Tv, stringResource(Res.string.tv_remote_settings)) }
        }
        TrackArtwork(artworkUrl = track.artworkUrl, seed = track.title, contentDescription = null,
            shape = RoundedCornerShape(24.dp), modifier = Modifier.widthIn(max = 400.dp).fillMaxWidth(.88f).aspectRatio(1f))
        Text(track.title, style = MaterialTheme.typography.headlineSmall, maxLines = 3,
            overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        Text(track.user.username, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center)
        Column(Modifier.fillMaxWidth()) {
            Slider(value = position.coerceIn(0f, state.durationMs.coerceAtLeast(1).toFloat()),
                onValueChange = { dragging = true; position = it },
                onValueChangeFinished = { dragging = false; controller.endScrub(position.toLong()) },
                valueRange = 0f..state.durationMs.coerceAtLeast(1).toFloat(), enabled = state.remoteOnline && state.durationMs > 0)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(tvRemoteTime(position.toLong()), style = MaterialTheme.typography.labelMedium)
                Text(tvRemoteTime(state.durationMs), style = MaterialTheme.typography.labelMedium)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(24.dp)) {
            IconButton(onClick = { controller.skipToPrevious() }, enabled = state.remoteOnline && (state.hasPrev || state.positionMs > 0)) {
                Icon(Icons.Default.SkipPrevious, stringResource(Res.string.player_previous), Modifier.size(32.dp))
            }
            FilledIconButton(onClick = { controller.togglePlayPause() }, enabled = state.remoteOnline, modifier = Modifier.size(76.dp)) {
                Icon(if (state.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                    stringResource(if (state.isPlaying) Res.string.tv_remote_pause else Res.string.tv_remote_play), Modifier.size(38.dp))
            }
            IconButton(onClick = { controller.skipToNext() }, enabled = state.remoteOnline && state.hasNext) {
                Icon(Icons.Default.SkipNext, stringResource(Res.string.player_next), Modifier.size(32.dp))
            }
        }
        if (state.remoteMessage.isNotBlank()) Text(state.remoteMessage, style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        if (state.remotePlaybackState == "error") OutlinedButton(onClick = { controller.retryTVStream() }, enabled = state.remoteOnline) {
            Text(stringResource(Res.string.tv_remote_retry))
        }
        OutlinedButton(onClick = { showQueue = true }, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(Res.string.player_queue))
        }
        TextButton(onClick = { TVRemoteSession.command("return-local") }, enabled = state.remoteOnline && track.id > 0) {
            Text(stringResource(Res.string.tv_remote_return_phone))
        }
    }
    if (showQueue) QueueSheet(controller, onDismiss = { showQueue = false })
}

private fun tvRemoteTime(value: Long): String {
    val seconds = value.coerceAtLeast(0) / 1000
    return if (seconds >= 3600) "${seconds / 3600}:${(seconds / 60 % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}"
    else "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
}
