use chrono::Local;
use std::fs::OpenOptions;
use std::io::Write;

pub fn log(level: &str, message: &str) {
    let now = Local::now();
    let formatted_time = now.format("%Y-%m-%d %H:%M:%S").to_string();
    let log_line = format!("[{}] [{}] {}\n", formatted_time, level, message);
    if level == "ERROR" {
        eprint!("{}", log_line);
    } else {
        print!("{}", log_line);
    }

    let log_path = std::env::temp_dir().join("sombra_backend.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
        let _ = file.write_all(log_line.as_bytes());
    }
}

pub fn info(message: &str) {
    log("INFO", message);
}

pub fn error(message: &str) {
    log("ERROR", message);
}
