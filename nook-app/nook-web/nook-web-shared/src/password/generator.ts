export type PasswordGenerationOptions = {
  length: number
  lowercase: boolean
  uppercase: boolean
  numbers: boolean
  symbols: boolean
}

export type GeneratePasswordFunction = (
  length: number,
  lowercase: boolean,
  uppercase: boolean,
  numbers: boolean,
  symbols: boolean,
) => string

export const defaultPasswordGenerationOptions: PasswordGenerationOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  numbers: true,
  symbols: true,
}

export function generatePasswordWithOptions(
  generatePassword: GeneratePasswordFunction,
  options: PasswordGenerationOptions,
): string {
  return generatePassword(
    options.length,
    options.lowercase,
    options.uppercase,
    options.numbers,
    options.symbols,
  )
}
