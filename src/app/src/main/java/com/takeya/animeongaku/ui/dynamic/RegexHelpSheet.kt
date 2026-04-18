package com.takeya.animeongaku.ui.dynamic

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Sky500

internal data class RegexSnippet(
    val pattern: String,
    val description: String,
    val example: String? = null
)

private val regexCheatSheet: List<Pair<String, List<RegexSnippet>>> = listOf(
    "Anchors" to listOf(
        RegexSnippet("^", "Start of text", "^OP → matches 'OP 1', not '1 OP'"),
        RegexSnippet("$", "End of text", "\\d+$ → matches 'Theme 2'"),
    ),
    "Quantifiers" to listOf(
        RegexSnippet("*", "Zero or more of the previous", "Op.* → 'Op', 'Opening'"),
        RegexSnippet("+", "One or more of the previous", "\\d+ → '1', '12', '123'"),
        RegexSnippet("?", "Optional (zero or one)", "Ops? → 'Op' or 'Ops'"),
        RegexSnippet("{2}", "Exactly N times", "\\d{2} → exactly 2 digits"),
    ),
    "Characters" to listOf(
        RegexSnippet(".", "Any single character", ". → any one character"),
        RegexSnippet("\\d", "Any digit (0–9)", "\\d+ → '1', '23'"),
        RegexSnippet("\\s", "Whitespace", "OP\\s\\d → 'OP 2'"),
        RegexSnippet("[OE]P", "Any of the listed chars", "[OE]P → 'OP' or 'EP'"),
        RegexSnippet("[^\\d]", "None of the listed chars", "[^\\d] → any non-digit"),
    ),
    "Groups & Alternation" to listOf(
        RegexSnippet("(a|b)", "Either a or b", "(OP|ED) → 'OP' or 'ED'"),
        RegexSnippet("(?i)", "Case-insensitive flag", "(?i)op → 'OP', 'Op', 'op'"),
    ),
    "Anime Examples" to listOf(
        RegexSnippet("^OP", "Starts with 'OP'", null),
        RegexSnippet("^(OP|ED)", "Opening or Ending", null),
        RegexSnippet("\\d+$", "Ends with a number", "Matches 'OP 1', 'ED 2'"),
        RegexSnippet("(?i)opening", "Contains 'opening' (any case)", null),
        RegexSnippet("OP \\d+|ED \\d+", "Numbered OP or ED", null),
    ),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun RegexHelpSheet(
    onDismiss: () -> Unit,
    onPatternSelected: (String) -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Ink800
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Regex Quick Reference",
                        color = Mist100,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "Tap any pattern to insert it",
                        color = Mist200,
                        fontSize = 13.sp
                    )
                }
                IconButton(onClick = onDismiss) {
                    Icon(
                        imageVector = Icons.Rounded.Close,
                        contentDescription = "Close",
                        tint = Mist200
                    )
                }
            }

            HorizontalDivider(color = Mist100.copy(alpha = 0.08f))

            LazyColumn(
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                regexCheatSheet.forEach { (category, snippets) ->
                    item(key = category) {
                        Text(
                            text = category.uppercase(),
                            color = Mist200,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = 0.8.sp,
                            modifier = Modifier.padding(start = 4.dp, end = 4.dp, top = 12.dp, bottom = 4.dp)
                        )
                    }
                    items(snippets, key = { "$category-${it.pattern}-${it.description}" }) { snippet ->
                        RegexSnippetRow(
                            snippet = snippet,
                            onClick = { onPatternSelected(snippet.pattern) }
                        )
                    }
                }
                item { Spacer(modifier = Modifier.height(8.dp)) }
            }
        }
    }
}

@Composable
private fun RegexSnippetRow(
    snippet: RegexSnippet,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 4.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Surface(
            color = Sky500.copy(alpha = 0.15f),
            shape = RoundedCornerShape(6.dp)
        ) {
            Text(
                text = snippet.pattern,
                color = Sky500,
                fontSize = 13.sp,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
            )
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = snippet.description,
                color = Mist100,
                fontSize = 13.sp
            )
            if (snippet.example != null) {
                Text(
                    text = snippet.example,
                    color = Mist200,
                    fontSize = 11.sp,
                    lineHeight = 14.sp
                )
            }
        }
    }
}
