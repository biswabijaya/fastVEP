//! Browser input checks only. Annotation remains in the native engine.
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn validate_vcf(text: &str) -> Result<u32, String> {
    let mut count = 0;
    for (i, line) in text.lines().enumerate() {
        if line.trim().is_empty() || line.starts_with('#') {
            continue;
        }
        let fields: Vec<_> = line.split('\t').collect();
        if fields.len() < 8 {
            return Err(format!(
                "Line {}: expected at least eight tab-separated VCF columns",
                i + 1
            ));
        }
        if fields[0].is_empty()
            || fields[1].parse::<u64>().map_or(true, |n| n == 0)
            || fields[3].is_empty()
            || fields[4].is_empty()
        {
            return Err(format!(
                "Line {}: check chromosome, position, reference and alternate allele",
                i + 1
            ));
        }
        count += 1;
        if count > 1000 {
            return Err("Please submit at most 1,000 variants per interactive request".into());
        }
    }
    if count == 0 {
        return Err("Add at least one VCF record".into());
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_records_and_reports_bad_lines() {
        assert_eq!(
            validate_vcf("##fileformat=VCFv4.2\n17\t10\t.\tA\tG\t.\tPASS\t."),
            Ok(1)
        );
        assert!(validate_vcf("17 10 . A G . PASS .")
            .unwrap_err()
            .contains("Line 1"));
        assert!(validate_vcf("17\t0\t.\tA\tG\t.\tPASS\t.").is_err());
        assert!(validate_vcf("#header").is_err());
    }
}
