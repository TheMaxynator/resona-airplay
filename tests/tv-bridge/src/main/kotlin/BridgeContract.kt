import com.savoo.scclient.compat.JSONObject
import com.savoo.scclient.player.TVRemoteSession

fun main() {
    val commands = mutableListOf<JSONObject>()
    TVRemoteSession.send = { commands.add(JSONObject(it)) }
    val one = """{"id":"slot-a","sourceId":"42","title":"First","artist":"Eva Vrijdag","artworkUrl":"https://example.org/a.jpg","duration":120}"""
    val two = """{"id":"slot-b","sourceId":"42","title":"Duplicate source","artist":"Eva Vrijdag","duration":120}"""
    fun state(queue: String = "$one,$two", revision: Int = 7, track: String = one) = """{"active":true,"online":true,"state":"playing","track":$track,"queue":[$queue],"index":0,"queueRevision":$revision,"position":17,"duration":120}"""
    TVRemoteSession.update(state())
    var current = TVRemoteSession.state.value
    check(current.track!!.id == 42L && current.track!!.user.username == "Eva Vrijdag")
    check(current.positionMs == 17000L && current.durationMs == 120000L)
    val ids = current.slots.map { it.entry.id }
    check(ids.size == 2 && ids.toSet().size == 2) // Duplicate songs remain distinct slots.
    TVRemoteSession.update(state())
    check(TVRemoteSession.state.value.slots.map { it.entry.id } == ids)
    check(TVRemoteSession.queueCommand("queue-play", 1))
    check(commands.last().getString("trackId") == "slot-b" && commands.last().getLong("queueRevision") == 7L)
    TVRemoteSession.reorder(ids.reversed(), 7)
    check(commands.last().getJSONArray("ids").getString(0) == "slot-b")
    TVRemoteSession.update(state("$two,$one", 8, two))
    check(TVRemoteSession.state.value.slots.map { it.entry.id } == ids.reversed())
    TVRemoteSession.update("""{"active":true,"online":false,"message":"Reconnecting"}""")
    current = TVRemoteSession.state.value
    check(current.active && !current.online && current.track!!.title == "Duplicate source")
    check(current.slots.size == 2 && current.positionMs == 17000L)
    check(TVRemoteSession.command("play")) // Still consumed by TV routing, never a local fallback.
    check(commands.last().getString("type") == "play")
    TVRemoteSession.update(state("", 9, "null"))
    check(TVRemoteSession.state.value.track == null && TVRemoteSession.state.value.slots.isEmpty())
    TVRemoteSession.update("""{"active":false}""")
    val count = commands.size
    check(!TVRemoteSession.command("play") && commands.size == count)
    check(!TVRemoteSession.state.value.active)
    TVRemoteSession.send = null
    println("PASS: real Kotlin TV bridge metadata, duplicate identities, queue commands, reconnect, stop and explicit local routing")
}
