package com.takeya.animeongaku.ui.search

internal fun searchFailureMessage(hasCachedResults: Boolean): String =
    if (hasCachedResults) "Couldn’t refresh. Showing saved results." else "Couldn’t search right now. Try again."
