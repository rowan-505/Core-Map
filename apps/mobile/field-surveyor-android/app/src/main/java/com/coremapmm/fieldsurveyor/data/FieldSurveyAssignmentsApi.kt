package com.coremapmm.fieldsurveyor.data

import com.coremapmm.fieldsurveyor.auth.AuthException
import com.coremapmm.fieldsurveyor.work.OutboxHttpResult
import com.coremapmm.fieldsurveyor.work.OutboxSyncPolicy
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

data class RemoteSurveyAssignment(
    val publicId: String,
    val routeVariantPublicId: String,
    val routePublicId: String?,
    val routeCode: String?,
    val variantCode: String?,
    val assignedDate: String,
    val dueDate: String?,
    val status: String,
    val workStatus: String,
    val remaining: Boolean,
    val updatedAt: String?,
)

sealed class SurveyAssignmentHttpResult {
    data class ListSuccess(val items: List<RemoteSurveyAssignment>) : SurveyAssignmentHttpResult()
    data class Failure(val result: OutboxHttpResult) : SurveyAssignmentHttpResult()
}

class FieldSurveyAssignmentsApi(private val baseUrl: String, private val client: OkHttpClient) {
    fun listActive(token: String): SurveyAssignmentHttpResult {
        val request = Request.Builder()
            .url(baseUrl.trimEnd('/') + "/field/survey-assignments?status=active")
            .header("Accept", "application/json")
            .header("Authorization", "Bearer $token")
            .get()
            .build()
        val response = try {
            client.newCall(request).execute()
        } catch (error: IOException) {
            return SurveyAssignmentHttpResult.Failure(OutboxSyncPolicy.classifyThrowable(error))
        }
        response.use {
            val raw = it.body?.string().orEmpty()
            if (it.code == 401) throw AuthException("Session expired", 401)
            if (it.code != 200) {
                return SurveyAssignmentHttpResult.Failure(OutboxSyncPolicy.classifyHttp(it.code, raw))
            }
            return try {
                val items = JSONObject(raw).getJSONArray("items")
                SurveyAssignmentHttpResult.ListSuccess(parseList(items))
            } catch (error: Exception) {
                SurveyAssignmentHttpResult.Failure(OutboxSyncPolicy.classifyThrowable(error))
            }
        }
    }

    private fun parseList(items: JSONArray): List<RemoteSurveyAssignment> =
        (0 until items.length()).map { parseOne(items.getJSONObject(it)) }

    private fun parseOne(value: JSONObject): RemoteSurveyAssignment {
        val route = value.optJSONObject("route")
        return RemoteSurveyAssignment(
            publicId = value.getString("publicId"),
            routeVariantPublicId = value.getString("routeVariantPublicId"),
            routePublicId = route?.optString("publicId")?.ifBlank { null },
            routeCode = route?.optString("code")?.ifBlank { null },
            variantCode = value.optString("variantCode").ifBlank { null },
            assignedDate = value.getString("assignedDate"),
            dueDate = if (value.isNull("dueDate")) null else value.optString("dueDate"),
            status = value.getString("status"),
            workStatus = value.getString("workStatus"),
            remaining = value.optBoolean("remaining", false),
            updatedAt = value.optString("updatedAt").ifBlank { null },
        )
    }
}
