//! The Orchard Street Long List, uniform word generation, and the parser that
//! turns what a person typed back into list words.
//!
//! The list is uniquely decodable: any concatenation of its words splits back
//! into those words one way only, so input typed without separators parses
//! too.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use std::collections::{BTreeSet, HashMap};
use std::fmt;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

use super::RecoveryPassphraseError;

/// The vendored list, unchanged; see `orchard-street-long.ATTRIBUTION.txt`.
const ORCHARD_STREET_LONG: &str = include_str!("orchard-street-long.txt");

/// One past the largest 15-bit draw; draws are masked to this range.
const DRAW_SPACE: u16 = 1 << 15;

/// The separator typed between words besides whitespace.
const HYPHEN: char = '-';

/// A word's length in bytes; every list word is lowercase ASCII.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct WordLength(usize);

/// The list's words in their published (alphabetical) order, and each word's
/// position in it.
struct WordList {
    words: Vec<&'static str>,
    positions: HashMap<&'static str, RecoveryWord>,
    longest: WordLength,
}

impl WordList {
    fn get() -> &'static Self {
        static LIST: OnceLock<WordList> = OnceLock::new();
        LIST.get_or_init(|| {
            let words = ORCHARD_STREET_LONG.lines().collect::<Vec<_>>();
            let positions = words
                .iter()
                .zip(0_u16..)
                .map(|(word, index)| (*word, RecoveryWord(index)))
                .collect();
            let longest = WordLength(words.iter().map(|word| word.len()).max().unwrap_or(0));
            Self {
                words,
                positions,
                longest,
            }
        })
    }

    fn size(&self) -> u16 {
        u16::try_from(self.words.len()).unwrap_or(u16::MAX)
    }
}

/// One word of the list, by its position in it. A recovery word carries no
/// text of its own; the list spells it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Zeroize)]
pub struct RecoveryWord(u16);

/// One random draw of 15 bits, before rejection.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RecoveryWordDraw(u16);

impl From<u16> for RecoveryWordDraw {
    fn from(value: u16) -> Self {
        Self(value)
    }
}

/// What one draw yields: a word, or nothing because the draw falls past the
/// list and must be drawn again. Rejecting those draws, rather than taking
/// them modulo the list size, keeps every word equally likely.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecoveryWordSample {
    Accepted(RecoveryWord),
    Rejected,
}

impl RecoveryWordDraw {
    /// Sample a word from this draw by rejection.
    #[must_use]
    pub fn sample(self) -> RecoveryWordSample {
        let Self(draw) = self;
        let masked = draw % DRAW_SPACE;
        match masked < WordList::get().size() {
            true => RecoveryWordSample::Accepted(RecoveryWord(masked)),
            false => RecoveryWordSample::Rejected,
        }
    }

    fn random() -> Result<Self, RecoveryPassphraseError> {
        let mut bytes = Zeroizing::new([0_u8; 2]);
        getrandom::fill(bytes.as_mut_slice())
            .map_err(|error| RecoveryPassphraseError::Random(error.to_string()))?;
        Ok(Self(u16::from_le_bytes(*bytes)))
    }
}

impl RecoveryWord {
    /// A word drawn uniformly from the list.
    pub fn generate() -> Result<Self, RecoveryPassphraseError> {
        loop {
            match RecoveryWordDraw::random()?.sample() {
                RecoveryWordSample::Accepted(word) => return Ok(word),
                RecoveryWordSample::Rejected => {}
            }
        }
    }

    /// The word as the list spells it.
    #[must_use]
    pub fn text(self) -> &'static str {
        let Self(index) = self;
        WordList::get()
            .words
            .get(usize::from(index))
            .copied()
            .unwrap_or_default()
    }

    fn of(text: &str) -> Option<Self> {
        WordList::get().positions.get(text).copied()
    }
}

/// A word's place in what was typed, counting from zero.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RecoveryWordPosition(u32);

impl RecoveryWordPosition {
    fn at(index: usize) -> Self {
        Self(u32::try_from(index).unwrap_or(u32::MAX))
    }
}

impl From<RecoveryWordPosition> for u32 {
    fn from(value: RecoveryWordPosition) -> Self {
        let RecoveryWordPosition(position) = value;
        position
    }
}

/// How many words a passphrase has, or how many were typed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RecoveryWordCount(u32);

impl RecoveryWordCount {
    pub const STANDARD: Self = Self(4);
    pub const HIGH: Self = Self(5);

    fn of(len: usize) -> Self {
        Self(u32::try_from(len).unwrap_or(u32::MAX))
    }

    fn len(self) -> usize {
        let Self(count) = self;
        usize::try_from(count).unwrap_or(usize::MAX)
    }
}

impl From<u32> for RecoveryWordCount {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

impl From<RecoveryWordCount> for u32 {
    fn from(value: RecoveryWordCount) -> Self {
        let RecoveryWordCount(count) = value;
        count
    }
}

/// One word as it was typed, lowercased. It may be part of a passphrase, so
/// it is wiped when dropped and never printed.
#[derive(Clone, PartialEq, Eq)]
pub struct TypedRecoveryWord(Zeroizing<String>);

impl TypedRecoveryWord {
    /// The typed word, for marking it in the form it was typed in.
    #[must_use]
    pub fn expose(&self) -> &str {
        let Self(text) = self;
        text
    }
}

impl fmt::Debug for TypedRecoveryWord {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("TypedRecoveryWord([REDACTED])")
    }
}

/// One typed word the list does not hold, with where it was typed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnknownRecoveryWord {
    pub position: RecoveryWordPosition,
    pub typed: TypedRecoveryWord,
}

/// What a person typed as a recovery passphrase: any case, words separated
/// by spaces, hyphens, or nothing at all. Wiped when dropped.
pub struct TypedRecoveryWords(Zeroizing<String>);

impl From<String> for TypedRecoveryWords {
    fn from(value: String) -> Self {
        Self(Zeroizing::new(value))
    }
}

impl TypedRecoveryWords {
    /// Lowercased chunks between separators.
    fn chunks(&self) -> Zeroizing<Vec<String>> {
        let Self(text) = self;
        let lowered = Zeroizing::new(text.to_lowercase());
        Zeroizing::new(
            lowered
                .split(|character: char| character.is_whitespace() || character == HYPHEN)
                .filter(|chunk| !chunk.is_empty())
                .map(str::to_owned)
                .collect(),
        )
    }

    /// The list words this input spells, checked word by word. Unknown words
    /// are reported together, each at its typed position.
    pub fn words(&self) -> Result<Vec<RecoveryWord>, RecoveryPassphraseError> {
        let chunks = self.chunks();
        if chunks.is_empty() {
            return Err(RecoveryPassphraseError::Empty);
        }
        let mut words = Vec::new();
        let mut unknown = Vec::new();
        for (index, chunk) in chunks.iter().enumerate() {
            match Segmentation::of(chunk) {
                Segmentation::Words(found) => words.extend(found),
                Segmentation::Unknown => unknown.push(UnknownRecoveryWord {
                    position: RecoveryWordPosition::at(index),
                    typed: TypedRecoveryWord(Zeroizing::new(chunk.clone())),
                }),
            }
        }
        match unknown.is_empty() {
            true => Ok(words),
            false => {
                words.zeroize();
                Err(RecoveryPassphraseError::UnknownWords(unknown))
            }
        }
    }

    /// The words, which must number exactly `expected`.
    pub fn words_of_count(
        &self,
        expected: RecoveryWordCount,
    ) -> Result<Vec<RecoveryWord>, RecoveryPassphraseError> {
        let mut words = self.words()?;
        let typed = RecoveryWordCount::of(words.len());
        match typed == expected {
            true => Ok(words),
            false => {
                words.zeroize();
                Err(RecoveryPassphraseError::WordCount { expected, typed })
            }
        }
    }
}

/// A prefix the person typed so far, and how many words to suggest for it.
pub struct RecoveryWordSuggestions<'a> {
    pub prefix: &'a str,
    pub limit: RecoveryWordCount,
}

impl RecoveryWordSuggestions<'_> {
    /// List words starting with the prefix, in list order. A blank prefix
    /// suggests nothing.
    #[must_use]
    pub fn words(&self) -> Vec<&'static str> {
        let prefix = self.prefix.trim().to_lowercase();
        match prefix.as_str() {
            "" => Vec::new(),
            prefix => {
                let words = &WordList::get().words;
                let start = words.partition_point(|word| *word < prefix);
                words
                    .iter()
                    .skip(start)
                    .take_while(|word| word.starts_with(prefix))
                    .take(self.limit.len())
                    .copied()
                    .collect()
            }
        }
    }
}

/// How one separator-free chunk splits into list words.
enum Segmentation {
    Words(Vec<RecoveryWord>),
    Unknown,
}

/// One word taken while splitting a chunk: where it ends and which word it is.
struct SplitStep {
    length: usize,
    word: RecoveryWord,
}

impl Segmentation {
    /// Split a chunk into list words, depth first. The list is uniquely
    /// decodable, so a complete split is the only one. A position that cannot
    /// finish a split is remembered, so each is explored once.
    fn of(chunk: &str) -> Self {
        let WordLength(longest) = WordList::get().longest;
        let mut dead_ends = BTreeSet::new();
        let mut path: Vec<SplitStep> = Vec::new();
        let mut start = 0;
        let mut shortest = 1;
        loop {
            if start == chunk.len() {
                return Self::Words(path.into_iter().map(|step| step.word).collect());
            }
            let found = (shortest..=longest.min(chunk.len() - start)).find_map(|length| {
                let end = start + length;
                match dead_ends.contains(&end) {
                    true => None,
                    false => chunk
                        .get(start..end)
                        .and_then(RecoveryWord::of)
                        .map(|word| SplitStep { length, word }),
                }
            });
            match found {
                Some(step) => {
                    start += step.length;
                    path.push(step);
                    shortest = 1;
                }
                None => {
                    dead_ends.insert(start);
                    let Some(step) = path.pop() else {
                        return Self::Unknown;
                    };
                    start -= step.length;
                    shortest = step.length + 1;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    const PINNED_SHA256: &str = "21b00942246dc7f0ecf5321dc22bc4ce2326b51ea72ea55697d754601ca115d2";

    fn typed(text: &str) -> TypedRecoveryWords {
        TypedRecoveryWords::from(text.to_owned())
    }

    fn texts(words: &[RecoveryWord]) -> Vec<&'static str> {
        words.iter().map(|word| word.text()).collect()
    }

    #[test]
    fn the_vendored_list_is_the_pinned_orchard_street_long_list() {
        assert_eq!(
            hex::encode(Sha256::digest(ORCHARD_STREET_LONG.as_bytes())),
            PINNED_SHA256
        );
        let words = &WordList::get().words;
        assert_eq!(words.len(), 17_576);
        assert_eq!(words.iter().collect::<BTreeSet<_>>().len(), 17_576);
        // Suggestions search the list in order.
        assert!(words.windows(2).all(|pair| pair.first() < pair.get(1)));
        assert!(
            words
                .iter()
                .all(|word| !word.is_empty() && word.bytes().all(|byte| byte.is_ascii_lowercase()))
        );
    }

    #[test]
    fn draws_inside_the_list_map_to_themselves_and_the_rest_are_rejected() {
        let size = WordList::get().size();
        assert_eq!(
            RecoveryWordDraw::from(0).sample(),
            RecoveryWordSample::Accepted(RecoveryWord(0))
        );
        assert_eq!(
            RecoveryWordDraw::from(size - 1).sample(),
            RecoveryWordSample::Accepted(RecoveryWord(size - 1))
        );
        // No draw past the list wraps onto a word: that would favour the
        // list's first words.
        for draw in size..DRAW_SPACE {
            assert_eq!(
                RecoveryWordDraw::from(draw).sample(),
                RecoveryWordSample::Rejected
            );
        }
        // The top bit is masked off, so every word has exactly two draws.
        for word in [0, 7, size / 2, size - 1] {
            let draws = (0..=u16::MAX)
                .filter(|draw| {
                    RecoveryWordDraw::from(*draw).sample()
                        == RecoveryWordSample::Accepted(RecoveryWord(word))
                })
                .count();
            assert_eq!(draws, 2);
        }
    }

    #[test]
    fn generated_words_spread_evenly_over_the_list() -> Result<(), RecoveryPassphraseError> {
        const DRAWS: usize = 70_304;
        const BUCKETS: usize = 8;
        let size = usize::from(WordList::get().size());
        let mut counts = [0_usize; BUCKETS];
        for _ in 0..DRAWS {
            let RecoveryWord(index) = RecoveryWord::generate()?;
            if let Some(count) = counts.get_mut(usize::from(index) * BUCKETS / size) {
                *count += 1;
            }
        }
        // Each eighth of the list expects 8,788 hits (sd about 88); a modulo
        // bias over the 15-bit draw would push the first eighths far above it.
        let expected = DRAWS / BUCKETS;
        assert!(
            counts.iter().all(|count| count.abs_diff(expected) < 450),
            "{counts:?}"
        );
        Ok(())
    }

    #[test]
    fn typed_words_ignore_case_and_take_spaces_hyphens_or_no_separator()
    -> Result<(), RecoveryPassphraseError> {
        let expected = vec!["abandon", "zoology", "logistic", "zoom"];
        for input in [
            "abandon zoology logistic zoom",
            "  Abandon   ZOOLOGY\tlogistic\nzoom ",
            "abandon-zoology-logistic-zoom",
            "abandonzoologylogisticzoom",
            "AbandonZoology logistic-zoom",
        ] {
            assert_eq!(texts(&typed(input).words()?), expected, "{input}");
        }
        Ok(())
    }

    #[test]
    fn generated_phrases_typed_without_separators_split_back_into_their_words()
    -> Result<(), RecoveryPassphraseError> {
        for _ in 0..300 {
            let words = (0..5)
                .map(|_| RecoveryWord::generate())
                .collect::<Result<Vec<_>, _>>()?;
            let joined = texts(&words).concat();
            assert_eq!(typed(&joined).words()?, words, "{joined}");
        }
        Ok(())
    }

    #[test]
    fn each_unknown_word_is_reported_at_its_typed_position() {
        let Err(RecoveryPassphraseError::UnknownWords(unknown)) =
            typed("abandon zoologyy logistic qqq").words()
        else {
            panic!("unknown words must be reported");
        };
        let reported = unknown
            .iter()
            .map(|word| (u32::from(word.position), word.typed.expose().to_owned()))
            .collect::<Vec<_>>();
        assert_eq!(
            reported,
            vec![(1, "zoologyy".to_owned()), (3, "qqq".to_owned())]
        );
        assert!(matches!(
            typed(" - \t").words(),
            Err(RecoveryPassphraseError::Empty)
        ));
        assert!(matches!(
            typed("abandon zoology logistic").words_of_count(RecoveryWordCount::STANDARD),
            Err(RecoveryPassphraseError::WordCount { expected, typed })
                if expected == RecoveryWordCount::STANDARD && u32::from(typed) == 3
        ));
    }

    #[test]
    fn suggestions_list_words_starting_with_the_typed_prefix() {
        let suggest = |prefix, limit| {
            RecoveryWordSuggestions {
                prefix,
                limit: RecoveryWordCount(limit),
            }
            .words()
        };
        assert_eq!(
            suggest("Abando", 3),
            vec!["abandon", "abandoned", "abandoning"]
        );
        assert_eq!(suggest("zoo", 3), vec!["zoo", "zoological", "zoologist"]);
        assert!(suggest("zzzz", 5).is_empty());
        assert!(suggest("  ", 5).is_empty());
    }
}
