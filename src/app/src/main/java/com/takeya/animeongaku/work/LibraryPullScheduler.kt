package com.takeya.animeongaku.work

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.takeya.animeongaku.data.server.ServerSettingsStore
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class LibraryPullScheduler @Inject constructor(
    @ApplicationContext private val context: Context,
    private val serverSettingsStore: ServerSettingsStore
) {
    fun schedule() {
        if (!serverSettingsStore.isConfigured) return

        val request = PeriodicWorkRequestBuilder<LibraryPullWorker>(6, TimeUnit.HOURS)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            LibraryPullWorker.UNIQUE_WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            request
        )
    }

    fun scheduleNow() {
        if (!serverSettingsStore.isConfigured) return

        val request = OneTimeWorkRequestBuilder<LibraryPullWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            "${LibraryPullWorker.UNIQUE_WORK_NAME}_now",
            ExistingWorkPolicy.REPLACE,
            request
        )
    }
}
