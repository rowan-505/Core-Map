package com.coremapmm.fieldsurveyor.ui.media

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import com.coremapmm.fieldsurveyor.media.JpegCompressor
import com.coremapmm.fieldsurveyor.ui.settings.tr
import java.io.File

@Composable
fun OnDemandJpegPreview(
    file: File,
    maxEdge: Int = 480,
    contentDescription: String,
) {
    var show by remember(file.absolutePath) { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (!show) {
            OutlinedButton(onClick = { show = true }) { Text(tr("Show photo preview")) }
        } else {
            val bitmap = remember(file.absolutePath, file.lastModified(), maxEdge) {
                JpegCompressor.loadPreview(file, maxEdge)?.asImageBitmap()
            }
            if (bitmap != null) {
                Image(
                    bitmap,
                    contentDescription,
                    Modifier.fillMaxWidth().height(120.dp),
                    contentScale = ContentScale.Fit,
                )
            } else {
                Text(tr("Photo file is missing."))
            }
            OutlinedButton(onClick = { show = false }, modifier = Modifier.padding(top = 4.dp)) {
                Text(tr("Hide preview"))
            }
        }
    }
}
