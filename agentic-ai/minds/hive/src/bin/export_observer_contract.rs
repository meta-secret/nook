use clap::Parser;
use hive::observer::contract_export::ObserverContractExport;
use std::path::PathBuf;

#[derive(Parser)]
struct Arguments {
    #[arg(long)]
    output: PathBuf,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let Arguments { output } = Arguments::parse();
    ObserverContractExport { output: &output }.write()?;
    Ok(())
}
