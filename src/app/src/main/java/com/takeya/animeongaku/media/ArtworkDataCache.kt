package com.takeya.animeongaku.media

class ArtworkDataCache(private val maxEntries: Int = DEFAULT_MAX_ENTRIES) {
    private val cache = object : LinkedHashMap<String, ByteArray>(maxEntries, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, ByteArray>?): Boolean =
            size > maxEntries
    }

    @Synchronized
    fun get(key: String): ByteArray? = cache[key]?.copyOf()

    @Synchronized
    fun put(key: String, bytes: ByteArray) {
        cache[key] = bytes.copyOf()
    }

    companion object {
        private const val DEFAULT_MAX_ENTRIES = 32
    }
}
