package com.coremapmm.fieldsurveyor.ui.routes

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.coremapmm.fieldsurveyor.data.transport.RouteSyncUi
import com.coremapmm.fieldsurveyor.data.transport.RouteSyncUiState
import com.coremapmm.fieldsurveyor.ui.components.StatusPill
import com.coremapmm.fieldsurveyor.ui.settings.tr

@Composable
fun RouteSyncStatusRow(
    state: RouteSyncUiState,
    onTryAgain: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .testTag("route_sync_status"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        StatusPill(
            label = tr(RouteSyncUi.label(state)),
            positive = RouteSyncUi.isPositive(state),
            // Soft cache / busy stay neutral. Red only when download failed with no cache.
            warning = RouteSyncUi.isSoftFailure(state) ||
                state is RouteSyncUiState.NotDownloaded ||
                RouteSyncUi.isBusy(state),
            blockingError = RouteSyncUi.isHardFailure(state),
        )
        if (RouteSyncUi.showTryAgain(state) && !RouteSyncUi.isBusy(state)) {
            TextButton(
                onClick = onTryAgain,
                modifier = Modifier
                    .heightIn(min = 36.dp)
                    .testTag("route_sync_try_again"),
            ) {
                Text(tr(RouteSyncUi.ACTION_TRY_AGAIN), style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}
