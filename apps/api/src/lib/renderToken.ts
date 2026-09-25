import { SignJWT, jwtVerify } from "jose";

/**
 * Short-lived tokens that let the PDF renderer load the print view with private
 * certificate details (SPEC §12). Bound to one proposal slug; 5-minute lifetime.
 */
const key = (secret: string) => new TextEncoder().encode(secret);

export async function createRenderToken(secret: string, slug: string): Promise<string> {
  return new SignJWT({ purpose: "render" }).setProtectedHeader({ alg: "HS256" }).setSubject(slug).setIssuedAt().setExpirationTime("5m").sign(key(secret));
}

export async function verifyRenderToken(secret: string, slug: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"], subject: slug });
    return payload.purpose === "render";
  } catch {
    return false;
  }
}
