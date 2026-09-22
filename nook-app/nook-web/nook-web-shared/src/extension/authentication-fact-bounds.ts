const MAX_AUTHENTICATION_CONTROL_TEXT_BYTES = 512;
type AuthenticationControlTexts = string[];

class AuthenticationFactBounds {
  private utf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).length;
  }

  controlTextFits(value: string): boolean {
    return this.utf8ByteLength(value) <= MAX_AUTHENTICATION_CONTROL_TEXT_BYTES;
  }

  controlTextsFit(values: AuthenticationControlTexts): boolean {
    return values.every(this.controlTextFits.bind(this));
  }
}

export const authenticationFactBounds = new AuthenticationFactBounds();
