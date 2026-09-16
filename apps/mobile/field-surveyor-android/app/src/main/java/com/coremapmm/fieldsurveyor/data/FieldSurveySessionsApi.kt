package com.coremapmm.fieldsurveyor.data

import com.coremapmm.fieldsurveyor.auth.AuthException
import com.coremapmm.fieldsurveyor.work.OutboxHttpResult
import com.coremapmm.fieldsurveyor.work.OutboxSyncPolicy
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.time.Instant

data class RemoteSurveySession(val publicId: String, val clientSessionId: String, val status: String)

sealed class SurveySessionHttpResult {
    data class Success(val session: RemoteSurveySession) : SurveySessionHttpResult()
    data class Failure(val result: OutboxHttpResult) : SurveySessionHttpResult()
}

class FieldSurveySessionsApi(private val baseUrl: String, private val client: OkHttpClient) {
    private val json = "application/json; charset=utf-8".toMediaType()

    fun create(token: String, row: LocalSurveySessionEntity): SurveySessionHttpResult = request(
        token,
        "/field/survey-sessions",
        JSONObject()
            .put("clientSessionId", row.clientSessionId)
            .put("routeVariantPublicId", row.variantPublicId)
            .put("snapshotRevision", row.snapshotRevision)
            .put("startedAt", Instant.ofEpochMilli(row.startedAtEpochMs).toString())
            .put("totalStopCount", row.totalStopCount)
            .toString(),
    )

    fun end(token: String, row: LocalSurveySessionEntity): SurveySessionHttpResult {
        val action = if (row.status == LocalSurveySessionEntity.STATUS_ABANDONED) "abandon" else "complete"
        return request(
            token,
            "/field/survey-sessions/${row.clientSessionId}/$action",
            JSONObject()
                .put("endedAt", Instant.ofEpochMilli(row.endedAtEpochMs!!).toString())
                .put("accumulatedActiveSeconds", row.accumulatedActiveSeconds)
                .toString(),
            patch = true,
        )
    }

    fun summary(token: String, row: LocalSurveySessionEntity): SurveySessionHttpResult {
        val body = JSONObject()
            .put("accumulatedActiveSeconds", row.accumulatedActiveSeconds)
            .put(
                "lastActivityAt",
                Instant.ofEpochMilli(row.lastActivityAtEpochMs ?: row.updatedAtEpochMs).toString(),
            )
            .put("checkedStopCount", row.checkedStopCount)
            .put("totalStopCount", row.totalStopCount)
            .put("pendingSyncCount", row.pendingSyncCount)
            .put("clientSyncState", row.syncState)
        if (row.lastCheckedStopSequence != null) {
            body.put("lastCheckedStopSequence", row.lastCheckedStopSequence)
        } else {
            body.put("lastCheckedStopSequence", JSONObject.NULL)
        }
        if (row.lastGpsAccuracyM != null) body.put("lastGpsAccuracyM", row.lastGpsAccuracyM.toDouble())
        if (row.lastLat != null) body.put("lastLat", row.lastLat)
        if (row.lastLng != null) body.put("lastLng", row.lastLng)
        if (row.lastGpsAtEpochMs != null) {
            body.put("lastGpsAt", Instant.ofEpochMilli(row.lastGpsAtEpochMs).toString())
        }
        return request(token, "/field/survey-sessions/${row.clientSessionId}/summary", body.toString(), patch = true)
    }

    fun finish(token: String, row: LocalSurveySessionEntity): SurveySessionHttpResult {
        val finishedAt = row.finishedAtEpochMs ?: row.updatedAtEpochMs
        val body = JSONObject()
            .put("finishedAt", Instant.ofEpochMilli(finishedAt).toString())
            .put("accumulatedActiveSeconds", row.accumulatedActiveSeconds)
        row.endedAtEpochMs?.let { body.put("stoppedAt", Instant.ofEpochMilli(it).toString()) }
        return request(token, "/field/survey-sessions/${row.clientSessionId}/finish", body.toString(), patch = true)
    }

    fun reopen(token: String, row: LocalSurveySessionEntity): SurveySessionHttpResult {
        val reopenedAt = row.reopenedAtEpochMs ?: row.updatedAtEpochMs
        return request(
            token,
            "/field/survey-sessions/${row.clientSessionId}/reopen",
            JSONObject().put("reopenedAt", Instant.ofEpochMilli(reopenedAt).toString()).toString(),
            patch = true,
        )
    }

    private fun request(token: String, path: String, body: String, patch: Boolean = false): SurveySessionHttpResult {
        val builder = Request.Builder().url(baseUrl.trimEnd('/') + path)
            .header("Accept", "application/json")
            .header("Authorization", "Bearer $token")
        val request = (if (patch) builder.patch(body.toRequestBody(json)) else builder.post(body.toRequestBody(json))).build()
        val response = try { client.newCall(request).execute() } catch (error: IOException) {
            return SurveySessionHttpResult.Failure(OutboxSyncPolicy.classifyThrowable(error))
        }
        response.use {
            val raw = it.body?.string().orEmpty()
            if (it.code == 401) throw AuthException("Session expired", 401)
            if (it.code !in listOf(200, 201)) {
                return SurveySessionHttpResult.Failure(OutboxSyncPolicy.classifyHttp(it.code, raw))
            }
            return try {
                val value = JSONObject(raw)
                SurveySessionHttpResult.Success(
                    RemoteSurveySession(value.getString("publicId"), value.getString("clientSessionId"), value.getString("status")),
                )
            } catch (error: Exception) {
                SurveySessionHttpResult.Failure(OutboxSyncPolicy.classifyThrowable(error))
            }
        }
    }
}
