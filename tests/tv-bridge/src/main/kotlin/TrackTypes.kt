package com.savoo.scclient.data.model

// Test-boundary data types only. The production state/command bridge and JSON
// implementation are compiled verbatim; the full app compiles real models in CI.
data class User(val username: String = "")
data class Track(val id: Long, val title: String = "", val user: User = User(),
    val durationMs: Long = 0, val artworkUrl: String? = null, val waveformUrl: String? = null)
