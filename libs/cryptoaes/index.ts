// Port of keiyoushi/extensions-source lib/cryptoaes/CryptoAES.kt and lib/cryptoaes/Deobfuscator.kt
//
// AES goes through WebCrypto, so CryptoAES.decrypt is async here. The Kotlin overloads (password: String vs
// keyBytes + ivBytes) are one function that dispatches on the second argument.
import { aesCbcDecrypt, Base64, evpBytesToKey, fromUtf8, utf8 } from "../../sdk/crypto.ts";

/** Conforming with CryptoJS AES method */
export const CryptoAES = {
  /**
   * Decrypt using CryptoJS defaults compatible method.
   * `decrypt(cipherText, password)`: key and IV from OpenSSL's EVP_BytesToKey (MD5, 1 round, salt at bytes 8..16).
   * `decrypt(cipherText, keyBytes, ivBytes)`: raw key and IV.
   * Any failure yields "", as upstream.
   *
   * @param cipherText base64 encoded ciphertext
   */
  async decrypt(cipherText: string, passwordOrKey: string | Uint8Array, ivBytes?: Uint8Array): Promise<string> {
    try {
      if (typeof passwordOrKey === "string") {
        const ctBytes = Base64.decode(cipherText);
        const saltBytes = ctBytes.slice(8, 16);
        const cipherTextBytes = ctBytes.slice(16);
        const { key, iv } = evpBytesToKey(utf8(passwordOrKey), saltBytes, 32, 16);
        return await decryptAES(cipherTextBytes, key, iv);
      }
      return await decryptAES(Base64.decode(cipherText), passwordOrKey, ivBytes!);
    } catch {
      return "";
    }
  },
};

async function decryptAES(cipherTextBytes: Uint8Array, keyBytes: Uint8Array, ivBytes: Uint8Array): Promise<string> {
  try {
    return fromUtf8(await aesCbcDecrypt(keyBytes, ivBytes, cipherTextBytes));
  } catch {
    return "";
  }
}

/**
 * Helper class to deobfuscate JavaScript strings encoded in JSFuck style.
 *
 * More info on JSFuck found [here](https://en.wikipedia.org/wiki/JSFuck).
 *
 * Currently only supports Numeric and decimal ('.') characters
 */
export const Deobfuscator = {
  deobfuscateJsPassword(inputString: string): string {
    let idx = 0;
    const brackets = ["[", "("];
    let evaluatedString = "";
    while (idx < inputString.length) {
      const chr = inputString[idx];
      if (!brackets.includes(chr)) {
        idx++;
        continue;
      }
      const closingIndex = getMatchingBracketIndex(idx, inputString);
      if (chr === "[") {
        const digit = calculateDigit(inputString.substring(idx, closingIndex));
        evaluatedString += digit;
      } else {
        evaluatedString += ".";
        if (inputString[closingIndex + 1] === "[") {
          const skippingIndex = getMatchingBracketIndex(closingIndex + 1, inputString);
          idx = skippingIndex + 1;
          continue;
        }
      }
      idx = closingIndex + 1;
    }
    return evaluatedString;
  },
};

function getMatchingBracketIndex(openingIndex: number, inputString: string): number {
  const openingBracket = inputString[openingIndex];
  const closingBracket = openingBracket === "[" ? "]" : ")";
  let counter = 0;
  for (let idx = openingIndex; idx < inputString.length; idx++) {
    if (inputString[idx] === openingBracket) counter++;
    if (inputString[idx] === closingBracket) counter--;

    if (counter === 0) return idx; // found matching bracket
    if (counter < 0) return -1; // unbalanced brackets
  }
  return -1; // matching bracket not found
}

function calculateDigit(inputSubString: string): string {
  /* 0 == '+[]'
     1 == '+!+[]'
     2 == '!+[]+!+[]'
     3 == '!+[]+!+[]+!+[]'
     ...
     therefore '!+[]' count equals the digit
     if count equals 0, check for '+[]' just to be sure
   */
  const digit = (inputSubString.match(/!\+\[]/g) ?? []).length; // matches '!+[]'
  if (digit === 0) {
    if ((inputSubString.match(/\+\[]/g) ?? []).length === 1) return "0"; // matches '+[]'
  } else if (digit >= 1 && digit <= 9) {
    return String(digit);
  }
  return "-"; // Illegal digit
}
