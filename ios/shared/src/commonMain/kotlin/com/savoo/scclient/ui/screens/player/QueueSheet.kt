package com.savoo.scclient.ui.screens.player

import com.savoo.scclient.compat.*
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DragHandle
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.LaunchedEffect
import kotlinx.coroutines.delay
import com.savoo.scclient.player.TVRemoteSession
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import org.jetbrains.compose.resources.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.savoo.scclient.resources.*
import com.savoo.scclient.player.PlayerController
import com.savoo.scclient.player.QueueEntry
import sh.calvin.reorderable.ReorderableItem
import sh.calvin.reorderable.rememberReorderableLazyListState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QueueSheet(
    controller: PlayerController,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
    ) {
        QueueContent(
            controller = controller,
            modifier = Modifier.fillMaxWidth().fillMaxHeight(0.85f),
        )
    }
}

@Composable
fun QueueContent(
    controller: PlayerController,
    modifier: Modifier = Modifier,
) {
    val hapticFeedback = LocalHapticFeedback.current
    val serverEntries by controller.queueEntries.collectAsState()
    var draft by remember { mutableStateOf<List<QueueEntry>?>(null) }
    var dragging by remember { mutableStateOf(false) }
    var capturedRevision by remember { mutableStateOf(-1L) }
    val entries = draft ?: serverEntries
    val state by controller.state.collectAsState()
    val lazyListState = rememberLazyListState()
    val reorderableState = rememberReorderableLazyListState(lazyListState) { from, to ->
        if (state.remoteTV) {
            val list = entries.toMutableList()
            if (from.index in list.indices && to.index in list.indices) { list.add(to.index, list.removeAt(from.index)); draft = list }
        } else controller.moveQueueItem(from.index, to.index)
    }
    LaunchedEffect(state.remoteQueueRevision, dragging) { if (!dragging && state.remoteQueueRevision != capturedRevision) draft = null }
    LaunchedEffect(dragging, draft) { if (!dragging && draft != null) { delay(2500); draft = null } }

    Column(modifier = modifier.padding(horizontal = 20.dp)) {
        Text(
            stringResource(Res.string.player_queue),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
        state.currentTrack?.let { current ->
            Text(
                if (state.remoteTV) stringResource(Res.string.tv_remote_playing) else playingFromSource(state.queueTag, current.user.username),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.height(12.dp))

        LazyColumn(state = lazyListState, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            itemsIndexed(entries, key = { _, entry -> entry.id }) { index, entry ->
                ReorderableItem(reorderableState, key = entry.id) { isDragging ->
                    QueueRow(
                        entry = entry,
                        isCurrent = entry.id == serverEntries.getOrNull(state.queueIndex)?.id,
                        isDragging = isDragging,
                        onPlay = { if (state.remoteTV) TVRemoteSession.entryCommand("queue-play", entry.id) else controller.playFromQueue(index) },
                        onRemove = { if (state.remoteTV) TVRemoteSession.entryCommand("queue-remove", entry.id) else controller.removeQueueItem(index) },
                        dragModifier = Modifier.longPressDraggableHandle(
                            onDragStarted = {
                                hapticFeedback.performHapticFeedback(HapticFeedbackType.LongPress)
                                if (state.remoteTV) { dragging = true; capturedRevision = state.remoteQueueRevision; draft = serverEntries }
                            },
                            onDragStopped = {
                                hapticFeedback.performHapticFeedback(HapticFeedbackType.LongPress)
                                if (state.remoteTV) {
                                    draft?.let { TVRemoteSession.reorder(it.map { item -> item.id }, capturedRevision) }
                                    dragging = false
                                }
                            },
                        ),
                    )
                }
            }
            item { Spacer(Modifier.height(12.dp)) }
        }
    }
}

@Composable
private fun QueueRow(
    entry: QueueEntry,
    isCurrent: Boolean,
    isDragging: Boolean,
    onPlay: () -> Unit,
    onRemove: () -> Unit,
    dragModifier: Modifier,
) {
    val track = entry.track
    val elevation by animateDpAsState(if (isDragging) 6.dp else 0.dp, label = "queueRowElevation")

    Surface(
        modifier = dragModifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = if (isCurrent) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f) else MaterialTheme.colorScheme.surface,
        shadowElevation = elevation,
        tonalElevation = elevation,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onPlay)
                .padding(vertical = 6.dp, horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Filled.DragHandle,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.width(10.dp))
            AsyncImage(
                model = track.artworkUrl?.replace("-large", "-t200x200"),
                contentDescription = null,
                modifier = Modifier.size(44.dp).clip(RoundedCornerShape(8.dp)),
            )
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    track.title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = if (isCurrent) FontWeight.Bold else FontWeight.Normal,
                    color = if (isCurrent) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    track.user.username,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            IconButton(onClick = onRemove) {
                Icon(
                    Icons.Filled.Close,
                    contentDescription = stringResource(Res.string.player_queue_remove),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
