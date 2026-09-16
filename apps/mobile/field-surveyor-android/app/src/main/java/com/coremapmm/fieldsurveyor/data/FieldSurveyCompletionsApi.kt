package com.coremapmm.fieldsurveyor.data

import com.coremapmm.fieldsurveyor.auth.AuthException
import com.coremapmm.fieldsurveyor.work.OutboxHttpResult
import com.coremapmm.fieldsurveyor.work.OutboxSyncPolicy
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

data class RemoteSurveyCompletion(
    val routeVariantPublicId: String,
    val finished: Boolean,
    val finishedAt: String?,
    val routeCode: String?,
    val variantCode: String?,
    val routePublicId: String?,
)

sealed class SurveyCompletionHttpResult {
    data class Success(val item: RemoteSurveyCompletion) : SurveyCompletionHttpResult()
    data class ListSuccess(val items: List<RemoteSurveyCompletion>) : SurveyCompletionHttpResult()
    data class Failure(val result: OutboxHttpResult) : SurveyCompletionHttpResult()
}

class FieldSurveyCompletionsApi(private val baseUrl: String, private val client: OkHttpClient) {
    private val json = "application/json; charset=utf-8".toMediaType()

    fun list(token: String): SurveyCompletionHttpResult {
        val request = Request.Builder()
            .url(baseUrl.trimEnd('/') + "/field/survey-completions")
            .header("Accept", "application/json")
            .header("Authorization", "Bearer $token")
            .get()
            .build()
        val response = try {
            client.newCall(request).execute()
        } catch (error: IOException) {
            return SurveyCompletionHttpResult.Failure(OutboxSyncPolicy.classifyThrowable(error))
        }
        response.use {
            val raw = it.body?.string().orEmpty()
            if (it.code == 401) throw AuthException("Session expired", 401)
            if (it.code != 200) {
                return SurveyCompletionHttpResult.Failure(OutboxSyncPolicy.classifyHttp(it.code, raw))
            }
            return try {
                val items = JSONObject(raw).getJSONArray("items")
                SurveyCompletionHttpResult.ListSuccess(parseList(items))
            } catch (error: Exception) {
                SurveyCompletionHttpResult.Failure(OutboxSyncPolicy.classifyThrowable(error))
            }
        }
    }

    fun put(token: String, row: LocalSurveyVariantCompletionEntity): SurveyCompletionHttpResult {
        val body = JSONObject().put("finished", row.isFinished).toString()
        val request = Request.Builder()
            .url(baseUrl.trimEnd('/') + "/field/survey-completions/${row.variantPublicId}")
            .header("Accept", "application/json")
            .header("Authorization", "Bearer $token")
            .put(body.toRequestBody(json))
            .build()
        val response = try {
            client.newCall(request).execute()
        } catch (error: IOException) {
            return SurveyCompletionHttpResult.Failure(OutboxSyncPolicy.classifyThrowable(error))
        }
        response.use {
            val raw = it.body?.string().orEmpty()
            if (it.code == 401) throw AuthException("Session expired", 401)
            if (it.code != 200) {
                return SurveyCompletionHttpResult.Failure(OutboxSyncPolicy.classifyHttp(it.code, raw))
            }
            return try {
                SurveyCompletionHttpResult.Success(parseOne(JSONObject(raw)))
            } catch (error: Exception) {
                SurveyCompletionHttpResult.Failure(OutboxSyncPolicy.classifyThrowable(error))
            }
        }
    }

    private fun parseList(items: JSONArray): List<RemoteSurveyCompletion> =
        (0 until items.length()).map { parseOne(items.getJSONObject(it)) }

    private fun parseOne(value: JSONObject): RemoteSurveyCompletion {
        val route = value.optJSONObject("route")
        return RemoteSurveyCompletion(
            routeVariantPublicId = value.getString("routeVariantPublicId"),
            finished = value.getBoolean("finished"),
            finishedAt = if (value.isNull("finishedAt")) null else value.optString("finishedAt"),
            routeCode = route?.optString("code"),
            variantCode = value.optString("variantCode").ifBlank { null },
            routePublicId = route?.optString("publicId"),
        )
    }
}
