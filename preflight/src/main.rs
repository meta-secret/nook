use std::env;
use std::ffi::OsString;
use std::io;
use std::process;

fn main() {
    if let Err(error) = PreflightCommand::run(env::args_os().skip(1)) {
        eprintln!("nook-preflight: {error}");
        process::exit(2);
    }
}

struct PreflightCommand {
    command: String,
}
impl PreflightCommand {
    fn run(arguments: impl IntoIterator<Item = OsString>) -> io::Result<()> {
        let mut arguments = arguments.into_iter();
        let command = arguments
            .next()
            .and_then(|value| value.into_string().ok())
            .ok_or_else(|| PreflightCommand::usage("expected a command"))?;
        if arguments.into_iter().next().is_some() {
            return Err(PreflightCommand::usage(
                "additional arguments are not supported",
            ));
        }

        Self { command }.execute()
    }
    fn execute(self) -> io::Result<()> {
        let Self { command } = self;
        Err(PreflightCommand::usage(&format!(
            "unknown command {command}"
        )))
    }
}

impl PreflightCommand {
    fn usage(message: &str) -> io::Error {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "{message}\n\
             usage:\n\
             \x20 nook-preflight <preflight-command>"
            ),
        )
    }
}
