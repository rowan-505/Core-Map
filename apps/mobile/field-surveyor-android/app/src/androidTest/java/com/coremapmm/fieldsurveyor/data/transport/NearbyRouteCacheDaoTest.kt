package com.coremapmm.fieldsurveyor.data.transport

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.coremapmm.fieldsurveyor.data.FieldDatabase
import com.coremapmm.fieldsurveyor.survey.GpsFix
import com.coremapmm.fieldsurveyor.survey.NearbyRouteRecommender
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NearbyRouteCacheDaoTest {
    private lateinit var db: FieldDatabase
    private lateinit var cache: TransportCacheDao

    @Before
    fun createDb() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext<Context>(),
            FieldDatabase::class.java,
        ).build()
        cache = db.transportCacheDao()
    }

    @After
    fun closeDb() = db.close()

    @Test
    fun offlineRoomPathRanksD0AndD1Separately() = runBlocking {
        seedYangonStops()
        val recommender = NearbyRouteRecommender(cache)
        val fix = GpsFix(16.80, 96.15, 8f, 1_000L)
        val rows = recommender.recommend(fix)
        assertEquals(2, rows.size)
        assertEquals(setOf("D0", "D1"), rows.map { it.selection.variantCode }.toSet())
        assertEquals(listOf("v-d0", "v-d1"), rows.map { it.selection.variantPublicId })
        assertTrue(rows[0].stopDistanceM <= rows[1].stopDistanceM)
        assertTrue(rows.all { it.nearestStopName.isNotBlank() })
    }

    @Test
    fun servingQueryReadsCachedStopsWithoutNetwork() = runBlocking {
        seedYangonStops()
        val hits = cache.servingVariantsInBounds(16.79, 16.81, 96.14, 96.16)
        assertTrue(hits.any { it.variantPublicId == "v-d0" })
        assertTrue(hits.any { it.variantPublicId == "v-d1" })
        assertTrue(hits.none { it.variantPublicId == "v-far" })
    }

    private suspend fun seedYangonStops() {
        cache.insertRoutes(listOf(CacheRouteEntity("r13", "13", null, "YBS 13")))
        cache.insertVariants(
            listOf(
                CacheVariantEntity("v-d0", "r13", "D0", 0, "Sule", "Hledan"),
                CacheVariantEntity("v-d1", "r13", "D1", 1, "Hledan", "Sule"),
                CacheVariantEntity("v-far", "r13", "D0", 0, "Far", "Away"),
            ),
        )
        cache.insertStops(
            listOf(
                CacheStopEntity("s1", "S1", null, "Sule", 16.8003, 96.1503),
                CacheStopEntity("s2", "S2", null, "Hledan", 16.8008, 96.1508),
                CacheStopEntity("s3", "S3", null, "Opposite", 16.8006, 96.1506),
                CacheStopEntity("s4", "S4", null, "Far", 17.20, 96.20),
                CacheStopEntity("s5", "S5", null, "Far 2", 17.21, 96.21),
            ),
        )
        cache.insertRouteStops(
            listOf(
                CacheRouteStopEntity("v-d0", "s1", 1),
                CacheRouteStopEntity("v-d0", "s2", 2),
                CacheRouteStopEntity("v-d1", "s3", 1),
                CacheRouteStopEntity("v-d1", "s2", 2),
                CacheRouteStopEntity("v-far", "s4", 1),
                CacheRouteStopEntity("v-far", "s5", 2),
            ),
        )
        cache.upsertMetadata(CacheMetadataEntity(snapshotRevision = "rev-offline"))
    }

    @Test
    fun orderedStopsStayOnSelectedVariant() = runBlocking {
        seedYangonStops()
        val d0 = cache.orderedStops("v-d0")
        val d1 = cache.orderedStops("v-d1")
        assertTrue(d0.all { it.variantPublicId == "v-d0" })
        assertTrue(d1.all { it.variantPublicId == "v-d1" })
        assertEquals(listOf(1, 2), d0.map { it.stopSequence })
        assertEquals(listOf(1, 2), d1.map { it.stopSequence })
        assertTrue(d0.none { it.stopPublicId == "s3" })
        assertTrue(d1.none { it.stopPublicId == "s1" })
    }
}
