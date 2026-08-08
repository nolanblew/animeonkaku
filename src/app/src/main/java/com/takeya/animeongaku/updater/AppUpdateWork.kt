package com.takeya.animeongaku.updater

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.takeya.animeongaku.BuildConfig
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

@HiltWorker
class AppUpdateWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val appUpdateManager: AppUpdateManager
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = when (appUpdateManager.checkForUpdates()) {
        is UpdateCheckResult.Failed -> Result.retry()
        else -> Result.success()
    }

    companion object {
        const val UNIQUE_WORK_NAME = "github_app_update_check"
    }
}

@Singleton
class AppUpdateScheduler @Inject constructor(
    @ApplicationContext private val context: Context
) {
    fun schedule() {
        val workManager = WorkManager.getInstance(context)
        if (!BuildConfig.UPDATER_ENABLED) {
            workManager.cancelUniqueWork(AppUpdateWorker.UNIQUE_WORK_NAME)
            return
        }

        val request = PeriodicWorkRequestBuilder<AppUpdateWorker>(6, TimeUnit.HOURS)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()

        workManager.enqueueUniquePeriodicWork(
            AppUpdateWorker.UNIQUE_WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            request
        )
    }
}
