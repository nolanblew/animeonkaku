package com.takeya.animeongaku

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.data.remote.AnimeThemesApiResponse
import org.junit.Assert.*
import org.junit.Test

/**
 * Tests that verify @field:Json vs @Json annotation behavior
 * with KotlinJsonAdapterFactory (reflection-based Moshi).
 */
class ApiResponseParsingTest {

    private val moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()

    private val adapter = moshi.adapter(AnimeThemesApiResponse::class.java)

    @Test
    fun `field-Json annotation on anime list works with reflection adapter`() {
        val json = """{"anime":[{"id":1,"name":"Test"}]}"""
        val response = adapter.fromJson(json)!!
        // If @field:Json didn't work, anime would be empty
        assertEquals(1, response.anime.size)
        assertEquals("Test", response.anime[0].name)
    }

    @Test
    fun `external_id field deserializes correctly`() {
        val json = """{"anime":[{"id":1,"name":"Test","resources":[{"external_id":"12345","site":"Kitsu"}],"animethemes":[]}]}"""
        val response = adapter.fromJson(json)!!
        val resource = response.anime[0].resources[0]
        assertEquals("12345", resource.externalId)
        assertEquals("Kitsu", resource.site)
    }

    @Test
    fun `external_id as number deserializes correctly`() {
        val json = """{"anime":[{"id":1,"name":"Test","resources":[{"external_id":12345,"site":"Kitsu"}],"animethemes":[]}]}"""
        val response = adapter.fromJson(json)!!
        val resource = response.anime[0].resources[0]
        // Moshi may deserialize as Double for Any? type
        assertNotNull(resource.externalId)
    }
}
