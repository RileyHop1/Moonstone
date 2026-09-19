//! # SyncTeX
//!
//! Jumps between a line of source and the spot in the PDF it produced,
//! by reading the `.synctex.gz` file every compile writes (the engine
//! runs with `--synctex`).
//!
//! The format is line-based text. Each page (`{n` … `}n`) holds boxes
//! and points, each tagged with the input file and line that made it:
//!
//! ```text
//! (7,1:8799519,10301145:22609920,491520,163839   hbox: tag,line:x,y:W,H,D
//! g1,4:10492314,10301145                        glue: tag,line:x,y
//! ```
//!
//! **Only points carry trustworthy lines.** A line box is tagged with
//! wherever TeX was when it *broke* the paragraph, which is often the
//! next file entirely; the glue and kerns inside it are tagged with
//! where each piece of text came from. So boxes are used to find which
//! printed line was clicked, and points to find where it came from.

use flate2::read::GzDecoder;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::{
    Path,
    PathBuf,
};
use tauri::{
    AppHandle,
    Runtime,
};

use crate::compiler::BUILD_DIR_NAME;
use crate::paths;

/// Scaled points per PDF point (big point): 65536 × 72.27 / 72.
const SP_PER_PDF_POINT: f64 = 65781.76;

/// A place in the source.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLocation {
    /// Absolute path of the source file.
    pub file: String,
    /// 1-based line.
    pub line: u32,
}

/// A place in the PDF, in PDF points from the page's top-left corner.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfLocation {
    /// 1-based page number.
    pub page: u32,
    pub x: f64,
    pub y: f64,
}

/// One box or point, converted to PDF points.
#[derive(Debug, Clone, PartialEq)]
struct Record {
    /// `(` for a line box, `[` `v` `h` for other boxes, else a point.
    kind: char,
    tag: u32,
    line: u32,
    page: u32,
    x: f64,
    /// The baseline.
    y: f64,
    width: f64,
    height: f64,
    depth: f64,
}

impl Record {
    /// Whether this record is a point, whose line can be trusted.
    fn is_point(&self) -> bool {
        matches!(self.kind, 'x' | 'k' | 'g' | '$')
    }
}

/// A parsed SyncTeX file.
#[derive(Debug, Default)]
struct SyncTex {
    /// Input tag → file path as the engine wrote it.
    inputs: HashMap<u32, String>,
    records: Vec<Record>,
}

/// Parses the text of a SyncTeX file.
///
/// # Parameters
///
/// * `text` - The decompressed file.
///
/// # Returns
///
/// The inputs and records. Lines it does not recognise are skipped.
fn parse(text: &str) -> SyncTex {
    let mut sync = SyncTex::default();
    let mut scale = 1.0 / SP_PER_PDF_POINT;
    let mut page = 0;

    for line in text.lines() {
        if let Some(input) = line.strip_prefix("Input:") {
            if let Some((tag, path)) = input.split_once(':') {
                if let (Ok(tag), false) = (tag.parse(), path.is_empty()) {
                    sync.inputs.insert(tag, path.to_string());
                }
            }
        } else if let Some(unit) = line.strip_prefix("Unit:") {
            scale = unit.parse::<f64>().unwrap_or(1.0) / SP_PER_PDF_POINT;
        } else if let Some(number) = line.strip_prefix('{') {
            page = number.parse().unwrap_or(page);
        } else if let Some(record) = parse_record(line, page, scale) {
            sync.records.push(record);
        }
    }

    sync
}

/// Parses one box or point record.
///
/// # Parameters
///
/// * `line` - The record, kind character first.
/// * `page` - The page it is on.
/// * `scale` - Multiplier from file units to PDF points.
///
/// # Returns
///
/// The record, or `None` for anything else.
fn parse_record(line: &str, page: u32, scale: f64) -> Option<Record> {
    let kind = line.chars().next()?;
    if !"[(vhxkg$".contains(kind) {
        return None;
    }

    let (ids, coordinates) = line[1..].split_once(':')?;
    let mut ids = ids.split(',').map(str::parse::<u32>);
    let (tag, source_line) = (ids.next()?.ok()?, ids.next()?.ok()?);

    let numbers: Vec<f64> = coordinates
        .split([':', ','])
        .map(|value| value.parse::<f64>().map(|n| n * scale))
        .collect::<Result<_, _>>()
        .ok()?;
    let value = |index: usize| numbers.get(index).copied().unwrap_or(0.0);

    Some(Record {
        kind,
        tag,
        line: source_line,
        page,
        x: value(0),
        y: value(1),
        width: value(2),
        height: value(3),
        depth: value(4),
    })
}

/// Finds where a source line was typeset.
///
/// # Parameters
///
/// * `sync` - The parsed file.
/// * `tags` - Every input tag naming the source file.
/// * `line` - The 1-based source line.
///
/// # Returns
///
/// The first point typeset from the nearest line that produced any
/// output, preferring lines at or after `line` — a blank line or a
/// comment has no output of its own, and what follows it is what the
/// author is looking for.
fn locate_in_pdf(sync: &SyncTex, tags: &[u32], line: u32) -> Option<PdfLocation> {
    sync.records
        .iter()
        .filter(|record| record.is_point() && tags.contains(&record.tag))
        .min_by_key(|record| {
            let after = record.line >= line;
            (!after, record.line.abs_diff(line))
        })
        .map(|record| PdfLocation {
            page: record.page,
            x: record.x,
            y: record.y,
        })
}

/// Finds which source line produced a point on a page.
///
/// # Parameters
///
/// * `sync` - The parsed file.
/// * `page` - The 1-based page clicked.
/// * `x`, `y` - The point, in PDF points from the top-left.
///
/// # Returns
///
/// The input tag and line, or `None` for an empty page.
fn locate_in_source(sync: &SyncTex, page: u32, x: f64, y: f64) -> Option<(u32, u32)> {
    let on_page = || sync.records.iter().filter(move |record| record.page == page);

    // The printed line clicked: the smallest line box around the point.
    let line_box = on_page()
        .filter(|record| {
            record.kind == '('
                && (record.x..=record.x + record.width).contains(&x)
                && (record.y - record.height..=record.y + record.depth).contains(&y)
        })
        .min_by(|a, b| (a.width * a.height).total_cmp(&(b.width * b.height)));

    let distance = |record: &Record| match line_box {
        Some(line_box) if record.y == line_box.y => (x - record.x).abs(),
        Some(_) => f64::INFINITY,
        None => (x - record.x).hypot(y - record.y),
    };

    // Points from unnamed inputs (class files, the format) lead nowhere
    // the author can edit.
    on_page()
        .filter(|record| {
            record.is_point()
                && sync.inputs.contains_key(&record.tag)
                && distance(record).is_finite()
        })
        .min_by(|a, b| distance(a).total_cmp(&distance(b)))
        .or(line_box)
        .map(|record| (record.tag, record.line))
}

/// Where the SyncTeX file for a published PDF lives.
///
/// # Parameters
///
/// * `pdf` - The PDF beside the project's sources.
///
/// # Returns
///
/// `<dir>/.moonstone-build/<stem>.synctex.gz`.
fn synctex_path(pdf: &Path) -> PathBuf {
    let stem = pdf.file_stem().unwrap_or_default().to_string_lossy();
    pdf.with_file_name(BUILD_DIR_NAME)
        .join(format!("{}.synctex.gz", stem))
}

/// Reads and parses the SyncTeX file for a PDF inside the root.
///
/// # Parameters
///
/// * `app` - Handle used to resolve the Moonstone root.
/// * `pdf_path` - The PDF the user is looking at.
///
/// # Errors
///
/// Returns an error if the PDF is outside the root or there is no
/// SyncTeX data for it yet.
fn load<R: Runtime>(app: &AppHandle<R>, pdf_path: &str) -> Result<SyncTex, String> {
    let root = paths::moonstone_root(app)?;
    let pdf = paths::ensure_within_root(&root, Path::new(pdf_path))?;
    let file = std::fs::File::open(synctex_path(&pdf))
        .map_err(|_| "There is no position data for this PDF. Compile it first".to_string())?;

    let mut text = String::new();
    GzDecoder::new(file)
        .read_to_string(&mut text)
        .map_err(|e| format!("Could not read the position data: {}", e))?;

    Ok(parse(&text))
}

/// Finds the source line behind a point in a compiled PDF.
///
/// # Parameters
///
/// * `pdf_path` - The PDF clicked.
/// * `page` - The 1-based page.
/// * `x`, `y` - The point, in PDF points from the top-left.
///
/// # Returns
///
/// The source file and line.
///
/// # Errors
///
/// See [`load`]; also when nothing editable was typeset there.
#[tauri::command]
pub async fn sync_to_source<R: Runtime>(
    app: AppHandle<R>,
    pdf_path: String,
    page: u32,
    x: f64,
    y: f64,
) -> Result<SourceLocation, String> {
    let sync = load(&app, &pdf_path)?;

    locate_in_source(&sync, page, x, y)
        .and_then(|(tag, line)| {
            let file = std::fs::canonicalize(sync.inputs.get(&tag)?).ok()?;
            Some(SourceLocation {
                file: paths::to_display_string(&file),
                line,
            })
        })
        .ok_or_else(|| "Nothing in the source matches that spot".to_string())
}

/// Finds where a source line appears in its compiled PDF.
///
/// # Parameters
///
/// * `pdf_path` - The PDF the source compiles into.
/// * `source_path` - The source file.
/// * `line` - The 1-based line.
///
/// # Returns
///
/// The PDF location.
///
/// # Errors
///
/// See [`load`]; also if the source is outside the root or never
/// reached the PDF.
#[tauri::command]
pub async fn sync_to_pdf<R: Runtime>(
    app: AppHandle<R>,
    pdf_path: String,
    source_path: String,
    line: u32,
) -> Result<PdfLocation, String> {
    let sync = load(&app, &pdf_path)?;
    let root = paths::moonstone_root(&app)?;
    let source = paths::ensure_within_root(&root, Path::new(&source_path))?;

    // The engine writes each input's path its own way (Windows gets
    // mixed separators), so both sides are compared canonically.
    let tags: Vec<u32> = sync
        .inputs
        .iter()
        .filter(|(_, path)| std::fs::canonicalize(path).is_ok_and(|path| path == source))
        .map(|(tag, _)| *tag)
        .collect();

    locate_in_pdf(&sync, &tags, line)
        .ok_or_else(|| "This file is not part of that PDF".to_string())
}

#[cfg(test)]
mod synctex_tests {
    use super::*;

    /// An excerpt of a real Tectonic 0.17.0 SyncTeX file: a section
    /// heading, then a paragraph from `main.tex` line 4 whose line box
    /// is tagged with `chapters/one.tex` (tag 7) because that is where
    /// TeX was when it broke the paragraph.
    const SAMPLE: &str = concat!(
        "SyncTeX Version:1\n",
        "Input:1:C:\\proj\\main.tex\n",
        "Input:2:\n",
        "Input:7:C:\\proj\\chapters/one.tex\n",
        "Output:pdf\n",
        "Magnification:1000\n",
        "Unit:1\n",
        "Content:\n",
        "!479\n",
        "{1\n",
        "[1,7:4736287,46220575:26673152,41484288,0\n",
        "(1,3:8799519,8865055:22609920,647391,5661\n",
        "g1,3:8799519,8865055\n",
        "k1,3:31409439,8865055:18800131\n",
        ")\n",
        "(7,1:8799519,10301145:22609920,491520,163839\n",
        "g1,4:10492314,10301145\n",
        "g1,4:18035508,10301145\n",
        "k7,1:31409439,10301145:12471501\n",
        ")\n",
        "(1,7:8799519,13905493:22609920,469238,135003\n",
        "k7,2:11417395,13905493:285450\n",
        ")\n",
        "]\n",
        "}1\n",
        "Postamble:\n",
    );

    /// Converts scaled points to PDF points, as the parser does.
    fn pt(sp: f64) -> f64 {
        sp / SP_PER_PDF_POINT
    }

    #[test]
    fn test_parse_reads_inputs_and_skips_unnamed_ones() {
        let sync = parse(SAMPLE);

        assert_eq!(sync.inputs.len(), 2);
        assert_eq!(sync.inputs[&7], "C:\\proj\\chapters/one.tex");
    }

    #[test]
    fn test_parse_converts_to_pdf_points() {
        let sync = parse(SAMPLE);
        let glue = sync.records.iter().find(|r| r.kind == 'g').unwrap();

        // 1in from the left edge, which is where TeX's origin sits.
        assert!((pt(4736287.0) - 72.0).abs() < 0.01);
        assert_eq!(glue.page, 1);
        assert!((glue.x - pt(8799519.0)).abs() < 1e-9);
    }

    #[test]
    fn test_locate_in_source_trusts_points_over_the_line_box() {
        // A click on the paragraph's first printed line. Its line box
        // says chapters/one.tex:1, which is wrong; the glue inside it
        // says main.tex:4, which is right.
        let sync = parse(SAMPLE);

        let found = locate_in_source(&sync, 1, pt(17000000.0), pt(10000000.0));

        assert_eq!(found, Some((1, 4)));
    }

    #[test]
    fn test_locate_in_source_picks_the_nearest_point_on_the_line() {
        let sync = parse(SAMPLE);

        let found = locate_in_source(&sync, 1, pt(12000000.0), pt(13800000.0));

        assert_eq!(found, Some((7, 2)));
    }

    #[test]
    fn test_locate_in_source_falls_back_to_the_nearest_point_off_any_line() {
        // In the margin, beside the heading.
        let sync = parse(SAMPLE);

        let found = locate_in_source(&sync, 1, pt(2000000.0), pt(8865055.0));

        assert_eq!(found, Some((1, 3)));
    }

    #[test]
    fn test_locate_in_source_finds_nothing_on_a_missing_page() {
        assert_eq!(locate_in_source(&parse(SAMPLE), 9, 10.0, 10.0), None);
    }

    #[test]
    fn test_locate_in_pdf_finds_the_first_point_from_a_line() {
        let sync = parse(SAMPLE);

        let found = locate_in_pdf(&sync, &[1], 4).unwrap();

        assert_eq!(found.page, 1);
        assert!((found.x - pt(10492314.0)).abs() < 1e-9);
        assert!((found.y - pt(10301145.0)).abs() < 1e-9);
    }

    #[test]
    fn test_locate_in_pdf_prefers_the_next_line_with_output() {
        // Nothing was typeset from line 1 of main.tex (\documentclass),
        // so the heading on line 3 is the answer, not nothing.
        let sync = parse(SAMPLE);

        let found = locate_in_pdf(&sync, &[1], 1).unwrap();

        assert!((found.y - pt(8865055.0)).abs() < 1e-9);
    }

    #[test]
    fn test_locate_in_pdf_finds_nothing_for_a_file_never_typeset() {
        assert_eq!(locate_in_pdf(&parse(SAMPLE), &[], 4), None);
    }

    #[test]
    fn test_synctex_path_sits_in_the_build_directory() {
        let path = synctex_path(Path::new("/p/thesis.pdf"));

        assert_eq!(path, Path::new("/p/.moonstone-build/thesis.synctex.gz"));
    }
}
