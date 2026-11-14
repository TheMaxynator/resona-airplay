package com.savoo.scclient.player

import com.savoo.scclient.compat.JSONArray
import com.savoo.scclient.compat.JSONObject
import com.savoo.scclient.data.model.Track
import com.savoo.scclient.data.model.User
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class TVQueueSlot(val key: String, val entry: QueueEntry)
data class TVRemoteState(
    val active: Boolean = false,
    val online: Boolean = false,
    val state: String = "idle",
    val track: Track? = null,
    val slots: List<TVQueueSlot> = emptyList(),
    val index: Int = -1,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val queueRevision: Long = -1,
    val message: String = "",
)

// The receiver owns this queue. Local AVPlayer state remains separate, so a
// network interruption can never silently turn TV controls into local playback.
object TVRemoteSession {
    private val mutable = MutableStateFlow(TVRemoteState())
    val state = mutable.asStateFlow()
    var send: ((String) -> Unit)? = null
    private val slotIds = mutableMapOf<String, Long>()
    private var nextId = -1L

    fun update(json: String) {
        val root = runCatching { JSONObject(json) }.getOrNull() ?: return
        if (!root.optBoolean("active")) {
            mutable.value = TVRemoteState(); slotIds.clear(); return
        }
        fun millis(value: Double): Long = if (value.isFinite()) (value.coerceIn(0.0, 604800.0) * 1000).toLong() else 0
        fun decode(item: JSONObject): TVQueueSlot {
            val key = item.optString("id")
            val slot = slotIds.getOrPut(key) { nextId-- }
            val sourceId = item.optString("sourceId").toLongOrNull()?.takeIf { it > 0 } ?: slot
            val art = item.optString("artworkRemoteUrl").ifBlank { item.optString("artworkUrl") }
                .takeIf { it.startsWith("https://") || it.startsWith("http://") }
            return TVQueueSlot(key, QueueEntry(slot, Track(
                id = sourceId, title = item.optString("title"), user = User(username = item.optString("artist")),
                durationMs = millis(item.optDouble("duration", 0.0)), artworkUrl = art,
                waveformUrl = item.optString("waveformUrl").takeIf { it.startsWith("https://wave.sndcdn.com/") },
            )))
        }
        val queue = root.optJSONArray("queue") ?: JSONArray()
        val reuseQueue = root.optLong("queueRevision", -1) >= 0 && root.optLong("queueRevision", -1) == mutable.value.queueRevision
        val slots = if (root.has("queue") && !reuseQueue) (0 until queue.length().coerceAtMost(100)).mapNotNull { queue.optJSONObject(it)?.let(::decode) } else mutable.value.slots
        val current = root.optJSONObject("track")?.let(::decode)?.entry?.track
        val liveKeys = slots.mapTo(mutableSetOf()) { it.key }
        root.optJSONObject("track")?.optString("id")?.let { liveKeys.add(it) }
        slotIds.keys.retainAll(liveKeys)
        mutable.value = TVRemoteState(
            active = true, online = root.optBoolean("online"), state = root.optString("state", mutable.value.state),
            track = if (root.has("track")) current else mutable.value.track, slots = slots, index = root.optInt("index", mutable.value.index),
            positionMs = millis(root.optDouble("position", mutable.value.positionMs / 1000.0)), durationMs = millis(root.optDouble("duration", mutable.value.durationMs / 1000.0)),
            queueRevision = root.optLong("queueRevision", mutable.value.queueRevision), message = root.optString("message"),
        )
    }

    fun command(type: String, positionMs: Long? = null): Boolean {
        if (!mutable.value.active) return false
        val body = JSONObject().put("type", type)
        if (positionMs != null) body.put("position", positionMs.coerceAtLeast(0) / 1000.0)
        send?.invoke(body.toString()); return true
    }

    fun queueCommand(type: String, index: Int, to: Int? = null): Boolean {
        val current = mutable.value
        if (!current.active) return false
        if (current.queueRevision < 0) { notice("Update Resona TV to use the shared queue."); return true }
        if (index !in current.slots.indices) return true
        val body = JSONObject().put("type", type).put("queueRevision", current.queueRevision)
        if (type == "queue-reorder") {
            if (to == null || to !in current.slots.indices || to == index) return true
            val order = current.slots.map { it.key }.toMutableList()
            order.add(to, order.removeAt(index)); body.put("ids", JSONArray(order))
        } else body.put("trackId", current.slots[index].key)
        send?.invoke(body.toString()); return true
    }

    fun entryCommand(type: String, entryId: Long) {
        val index = mutable.value.slots.indexOfFirst { it.entry.id == entryId }
        if (index >= 0) queueCommand(type, index)
    }

    fun reorder(entryIds: List<Long>, revision: Long) {
        val current = mutable.value
        if (!current.active || current.queueRevision < 0) return
        val keys = entryIds.mapNotNull { id -> current.slots.find { it.entry.id == id }?.key }
        if (keys.size != current.slots.size || keys.toSet().size != keys.size) { notice("The queue changed. Please try again."); return }
        send?.invoke(JSONObject().put("type", "queue-reorder").put("queueRevision", revision).put("ids", JSONArray(keys)).toString())
    }

    fun notice(message: String) { send?.invoke(JSONObject().put("type", "notice").put("message", message).toString()) }
}
