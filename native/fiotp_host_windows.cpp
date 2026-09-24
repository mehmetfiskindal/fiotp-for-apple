#include "fiotp_host.h"

#ifdef _WIN32

#define NOMINMAX
#include <windows.h>
#include <bcrypt.h>
#include <shobjidl.h>
#include <shlobj.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <limits>
#include <map>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#pragma comment(lib, "Bcrypt.lib")
#pragma comment(lib, "Ole32.lib")
#pragma comment(lib, "Shell32.lib")
#pragma comment(lib, "User32.lib")

namespace {
namespace fs = std::filesystem;
constexpr ULONG kIterations = 600000;
constexpr size_t kKeyLength = 32;
constexpr size_t kSaltLength = 16;
constexpr size_t kNonceLength = 12;
constexpr size_t kTagLength = 16;
constexpr size_t kMaxFileSize = 32 * 1024 * 1024;

struct Json {
  enum class Kind { Null, Boolean, Number, String, Array, Object } kind = Kind::Null;
  bool boolean = false;
  double number = 0;
  std::string text;
  std::vector<Json> array;
  std::map<std::string, Json> object;

  static Json makeObject() { Json value; value.kind = Kind::Object; return value; }
  static Json makeArray() { Json value; value.kind = Kind::Array; return value; }
  static Json makeString(std::string text) { Json value; value.kind = Kind::String; value.text = std::move(text); return value; }
  static Json makeNumber(double number) { Json value; value.kind = Kind::Number; value.number = number; return value; }
  static Json makeBool(bool boolean) { Json value; value.kind = Kind::Boolean; value.boolean = boolean; return value; }
  bool isObject() const { return kind == Kind::Object; }
  bool isArray() const { return kind == Kind::Array; }
  bool isString() const { return kind == Kind::String; }
  const Json *find(const std::string &key) const {
    const auto it = object.find(key);
    return it == object.end() ? nullptr : &it->second;
  }
  Json &operator[](const std::string &key) {
    if (kind != Kind::Object) { kind = Kind::Object; object.clear(); }
    return object[key];
  }
};

void appendUtf8(std::string &out, unsigned codepoint) {
  if (codepoint <= 0x7f) out.push_back(static_cast<char>(codepoint));
  else if (codepoint <= 0x7ff) {
    out.push_back(static_cast<char>(0xc0 | (codepoint >> 6)));
    out.push_back(static_cast<char>(0x80 | (codepoint & 0x3f)));
  } else if (codepoint <= 0xffff) {
    out.push_back(static_cast<char>(0xe0 | (codepoint >> 12)));
    out.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3f)));
    out.push_back(static_cast<char>(0x80 | (codepoint & 0x3f)));
  } else {
    out.push_back(static_cast<char>(0xf0 | (codepoint >> 18)));
    out.push_back(static_cast<char>(0x80 | ((codepoint >> 12) & 0x3f)));
    out.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3f)));
    out.push_back(static_cast<char>(0x80 | (codepoint & 0x3f)));
  }
}

class JsonParser {
 public:
  explicit JsonParser(const std::string &source) : source_(source) {}
  Json parse() {
    Json result = readValue(0);
    whitespace();
    if (position_ != source_.size()) throw std::runtime_error("JSON verisinin sonunda beklenmeyen içerik var.");
    return result;
  }

 private:
  const std::string &source_;
  size_t position_ = 0;

  void whitespace() {
    while (position_ < source_.size() && (source_[position_] == ' ' || source_[position_] == '\t' ||
           source_[position_] == '\r' || source_[position_] == '\n')) ++position_;
  }
  bool consume(char character) {
    whitespace();
    if (position_ < source_.size() && source_[position_] == character) { ++position_; return true; }
    return false;
  }
  void expect(char character) {
    if (!consume(character)) throw std::runtime_error("Geçersiz JSON verisi.");
  }
  unsigned hex4() {
    if (position_ + 4 > source_.size()) throw std::runtime_error("JSON Unicode alanı eksik.");
    unsigned value = 0;
    for (unsigned i = 0; i < 4; ++i) {
      const char ch = source_[position_++];
      value <<= 4;
      if (ch >= '0' && ch <= '9') value |= static_cast<unsigned>(ch - '0');
      else if (ch >= 'a' && ch <= 'f') value |= static_cast<unsigned>(ch - 'a' + 10);
      else if (ch >= 'A' && ch <= 'F') value |= static_cast<unsigned>(ch - 'A' + 10);
      else throw std::runtime_error("JSON Unicode alanı geçersiz.");
    }
    return value;
  }
  std::string readString() {
    expect('"');
    std::string out;
    while (position_ < source_.size()) {
      const unsigned char ch = static_cast<unsigned char>(source_[position_++]);
      if (ch == '"') return out;
      if (ch < 0x20) throw std::runtime_error("JSON metninde geçersiz karakter var.");
      if (ch != '\\') { out.push_back(static_cast<char>(ch)); continue; }
      if (position_ >= source_.size()) throw std::runtime_error("JSON kaçış dizisi eksik.");
      switch (source_[position_++]) {
        case '"': out.push_back('"'); break;
        case '\\': out.push_back('\\'); break;
        case '/': out.push_back('/'); break;
        case 'b': out.push_back('\b'); break;
        case 'f': out.push_back('\f'); break;
        case 'n': out.push_back('\n'); break;
        case 'r': out.push_back('\r'); break;
        case 't': out.push_back('\t'); break;
        case 'u': {
          unsigned codepoint = hex4();
          if (codepoint >= 0xd800 && codepoint <= 0xdbff) {
            if (position_ + 2 > source_.size() || source_[position_] != '\\' || source_[position_ + 1] != 'u')
              throw std::runtime_error("JSON eşlenik Unicode alanı eksik.");
            position_ += 2;
            const unsigned low = hex4();
            if (low < 0xdc00 || low > 0xdfff) throw std::runtime_error("JSON eşlenik Unicode alanı geçersiz.");
            codepoint = 0x10000 + ((codepoint - 0xd800) << 10) + (low - 0xdc00);
          } else if (codepoint >= 0xdc00 && codepoint <= 0xdfff) {
            throw std::runtime_error("JSON Unicode alanı geçersiz.");
          }
          appendUtf8(out, codepoint);
          break;
        }
        default: throw std::runtime_error("JSON kaçış dizisi geçersiz.");
      }
    }
    throw std::runtime_error("JSON metni kapanmamış.");
  }
  Json readValue(unsigned depth) {
    if (depth > 64) throw std::runtime_error("JSON iç içe geçme sınırını aşıyor.");
    whitespace();
    if (position_ >= source_.size()) throw std::runtime_error("JSON verisi eksik.");
    const char ch = source_[position_];
    if (ch == '{') {
      ++position_;
      Json value = Json::makeObject();
      if (consume('}')) return value;
      do {
        whitespace();
        if (position_ >= source_.size() || source_[position_] != '"') throw std::runtime_error("JSON nesne anahtarı geçersiz.");
        const std::string key = readString();
        expect(':');
        value.object[key] = readValue(depth + 1);
      } while (consume(','));
      expect('}');
      return value;
    }
    if (ch == '[') {
      ++position_;
      Json value = Json::makeArray();
      if (consume(']')) return value;
      do { value.array.push_back(readValue(depth + 1)); } while (consume(','));
      expect(']');
      return value;
    }
    if (ch == '"') return Json::makeString(readString());
    if (source_.compare(position_, 4, "true") == 0) { position_ += 4; return Json::makeBool(true); }
    if (source_.compare(position_, 5, "false") == 0) { position_ += 5; return Json::makeBool(false); }
    if (source_.compare(position_, 4, "null") == 0) { position_ += 4; return Json(); }
    const size_t start = position_;
    if (source_[position_] == '-') ++position_;
    if (position_ >= source_.size() || source_[position_] < '0' || source_[position_] > '9')
      throw std::runtime_error("JSON değeri geçersiz.");
    if (source_[position_] == '0') ++position_;
    else while (position_ < source_.size() && source_[position_] >= '0' && source_[position_] <= '9') ++position_;
    if (position_ < source_.size() && source_[position_] == '.') {
      ++position_;
      const size_t fraction = position_;
      while (position_ < source_.size() && source_[position_] >= '0' && source_[position_] <= '9') ++position_;
      if (fraction == position_) throw std::runtime_error("JSON sayısı geçersiz.");
    }
    if (position_ < source_.size() && (source_[position_] == 'e' || source_[position_] == 'E')) {
      ++position_;
      if (position_ < source_.size() && (source_[position_] == '+' || source_[position_] == '-')) ++position_;
      const size_t exponent = position_;
      while (position_ < source_.size() && source_[position_] >= '0' && source_[position_] <= '9') ++position_;
      if (exponent == position_) throw std::runtime_error("JSON sayısı geçersiz.");
    }
    const double number = std::strtod(source_.c_str() + start, nullptr);
    if (!std::isfinite(number)) throw std::runtime_error("JSON sayısı sınır dışında.");
    return Json::makeNumber(number);
  }
};

void appendQuoted(std::string &out, const std::string &text) {
  static const char hex[] = "0123456789abcdef";
  out.push_back('"');
  for (unsigned char ch : text) {
    switch (ch) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (ch < 0x20) { out += "\\u00"; out.push_back(hex[ch >> 4]); out.push_back(hex[ch & 0x0f]); }
        else out.push_back(static_cast<char>(ch));
    }
  }
  out.push_back('"');
}

std::string dumpJson(const Json &value) {
  switch (value.kind) {
    case Json::Kind::Null: return "null";
    case Json::Kind::Boolean: return value.boolean ? "true" : "false";
    case Json::Kind::Number: {
      std::ostringstream output;
      output << std::setprecision(17) << value.number;
      return output.str();
    }
    case Json::Kind::String: { std::string out; appendQuoted(out, value.text); return out; }
    case Json::Kind::Array: {
      std::string out = "[";
      for (size_t i = 0; i < value.array.size(); ++i) { if (i) out.push_back(','); out += dumpJson(value.array[i]); }
      out.push_back(']');
      return out;
    }
    case Json::Kind::Object: {
      std::string out = "{";
      bool first = true;
      for (const auto &entry : value.object) {
        if (!first) out.push_back(',');
        first = false;
        appendQuoted(out, entry.first); out.push_back(':'); out += dumpJson(entry.second);
      }
      out.push_back('}');
      return out;
    }
  }
  return "null";
}

std::string fieldString(const Json &object, const char *name, std::string fallback = {}) {
  const Json *value = object.find(name);
  if (!value || value->kind == Json::Kind::Null) return fallback;
  if (!value->isString()) throw std::runtime_error(std::string("Geçersiz istek alanı: ") + name);
  return value->text;
}

ULONG fieldIterations(const Json &object) {
  const Json *value = object.find("iterations");
  if (!value || value->kind != Json::Kind::Number || value->number < 100000 || value->number > 5000000 ||
      std::floor(value->number) != value->number) throw std::runtime_error("Kasa KDF bilgileri geçersiz.");
  return static_cast<ULONG>(value->number);
}

std::wstring toWide(const std::string &text) {
  if (text.empty()) return {};
  const int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), nullptr, 0);
  if (count <= 0) throw std::runtime_error("Metin UTF-8 biçiminde çözümlenemedi.");
  std::wstring out(static_cast<size_t>(count), L'\0');
  if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), out.data(), count) != count)
    throw std::runtime_error("Metin Windows biçimine dönüştürülemedi.");
  return out;
}

std::string fromWide(const std::wstring &text) {
  if (text.empty()) return {};
  const int count = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), nullptr, 0, nullptr, nullptr);
  if (count <= 0) throw std::runtime_error("Windows metni UTF-8 biçimine dönüştürülemedi.");
  std::string out(static_cast<size_t>(count), '\0');
  if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), out.data(), count, nullptr, nullptr) != count)
    throw std::runtime_error("Windows metni UTF-8 biçimine dönüştürülemedi.");
  return out;
}

std::string pathUtf8(const fs::path &path) {
  const auto value = path.u8string();
  return std::string(value.begin(), value.end());
}

fs::path pathFromUtf8(const std::string &path) { return fs::u8path(path); }

std::wstring environmentPath(const wchar_t *name) {
  const DWORD required = GetEnvironmentVariableW(name, nullptr, 0);
  if (required == 0) return {};
  std::wstring value(required, L'\0');
  const DWORD written = GetEnvironmentVariableW(name, value.data(), required);
  if (written == 0 || written >= required) return {};
  value.resize(written);
  return value;
}

fs::path defaultVaultPath() {
  std::wstring root = environmentPath(L"APPDATA");
  if (root.empty()) root = environmentPath(L"USERPROFILE") + L"\\AppData\\Roaming";
  if (root.empty()) root = L".";
  return fs::path(root) / L"FiOTP" / L"kasa.json";
}

fs::path settingsPath() {
  std::wstring root = environmentPath(L"APPDATA");
  if (root.empty()) root = environmentPath(L"USERPROFILE") + L"\\AppData\\Roaming";
  if (root.empty()) root = L".";
  return fs::path(root) / L"FiOTP" / L"settings.json";
}

fs::path expandPath(const std::string &value) {
  if (value.empty()) return defaultVaultPath();
  std::string expanded = value;
  if (expanded == "~" || expanded.rfind("~/", 0) == 0 || expanded.rfind("~\\", 0) == 0) {
    const std::string home = fromWide(environmentPath(L"USERPROFILE"));
    expanded = home + (expanded.size() > 1 ? expanded.substr(1) : std::string());
  }
  fs::path path = pathFromUtf8(expanded);
  if (path.is_relative()) path = fs::absolute(path);
  return path.lexically_normal();
}

void checkStatus(NTSTATUS status, const char *message) {
  if (status < 0) throw std::runtime_error(message);
}

struct AlgorithmHandle {
  BCRYPT_ALG_HANDLE value = nullptr;
  ~AlgorithmHandle() { if (value) BCryptCloseAlgorithmProvider(value, 0); }
};
struct KeyHandle {
  BCRYPT_KEY_HANDLE value = nullptr;
  ~KeyHandle() { if (value) BCryptDestroyKey(value); }
};
struct CleanBytes {
  std::vector<UCHAR> &bytes;
  ~CleanBytes() { if (!bytes.empty()) SecureZeroMemory(bytes.data(), bytes.size()); }
};

std::vector<UCHAR> gKey;
std::string gVaultPath;

void clearKey() {
  if (!gKey.empty()) SecureZeroMemory(gKey.data(), gKey.size());
  gKey.clear();
  gKey.shrink_to_fit();
  gVaultPath.clear();
}

std::vector<UCHAR> randomBytes(size_t length) {
  if (length > std::numeric_limits<ULONG>::max()) throw std::runtime_error("Güvenli rastgele veri üretilemedi.");
  std::vector<UCHAR> out(length);
  if (length) checkStatus(BCryptGenRandom(nullptr, out.data(), static_cast<ULONG>(length), BCRYPT_USE_SYSTEM_PREFERRED_RNG),
                          "Güvenli rastgele veri üretilemedi.");
  return out;
}

std::string base64Encode(const UCHAR *bytes, size_t length) {
  static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((length + 2) / 3) * 4);
  for (size_t offset = 0; offset < length; offset += 3) {
    const size_t remaining = length - offset;
    const unsigned a = bytes[offset];
    const unsigned b = remaining > 1 ? bytes[offset + 1] : 0;
    const unsigned c = remaining > 2 ? bytes[offset + 2] : 0;
    out.push_back(alphabet[a >> 2]);
    out.push_back(alphabet[((a & 3) << 4) | (b >> 4)]);
    out.push_back(remaining > 1 ? alphabet[((b & 15) << 2) | (c >> 6)] : '=');
    out.push_back(remaining > 2 ? alphabet[c & 63] : '=');
  }
  return out;
}

std::string base64Encode(const std::vector<UCHAR> &bytes) { return base64Encode(bytes.data(), bytes.size()); }

std::vector<UCHAR> base64Decode(const std::string &text) {
  if (text.empty()) return {};
  if (text.size() % 4 != 0) throw std::runtime_error("Kasa Base64 alanı bozuk.");
  auto valueOf = [](unsigned char ch) -> int {
    if (ch >= 'A' && ch <= 'Z') return ch - 'A';
    if (ch >= 'a' && ch <= 'z') return ch - 'a' + 26;
    if (ch >= '0' && ch <= '9') return ch - '0' + 52;
    if (ch == '+') return 62;
    if (ch == '/') return 63;
    return -1;
  };
  std::vector<UCHAR> out;
  out.reserve((text.size() / 4) * 3);
  for (size_t i = 0; i < text.size(); i += 4) {
    const bool last = i + 4 == text.size();
    const int a = valueOf(static_cast<unsigned char>(text[i]));
    const int b = valueOf(static_cast<unsigned char>(text[i + 1]));
    const bool padC = text[i + 2] == '=';
    const bool padD = text[i + 3] == '=';
    const int c = padC ? 0 : valueOf(static_cast<unsigned char>(text[i + 2]));
    const int d = padD ? 0 : valueOf(static_cast<unsigned char>(text[i + 3]));
    if (a < 0 || b < 0 || c < 0 || d < 0 || (!last && (padC || padD)) || (padC && !padD))
      throw std::runtime_error("Kasa Base64 alanı bozuk.");
    const unsigned bits = (static_cast<unsigned>(a) << 18) | (static_cast<unsigned>(b) << 12) |
                          (static_cast<unsigned>(c) << 6) | static_cast<unsigned>(d);
    out.push_back(static_cast<UCHAR>((bits >> 16) & 0xff));
    if (!padC) out.push_back(static_cast<UCHAR>((bits >> 8) & 0xff));
    if (!padD) out.push_back(static_cast<UCHAR>(bits & 0xff));
  }
  return out;
}

std::vector<UCHAR> deriveKey(const std::string &password, const std::vector<UCHAR> &salt, ULONG iterations) {
  AlgorithmHandle algorithm;
  checkStatus(BCryptOpenAlgorithmProvider(&algorithm.value, BCRYPT_SHA256_ALGORITHM, nullptr, BCRYPT_ALG_HANDLE_HMAC_FLAG),
              "Parola anahtarı türetilemedi.");
  std::vector<UCHAR> key(kKeyLength);
  checkStatus(BCryptDeriveKeyPBKDF2(algorithm.value, reinterpret_cast<PUCHAR>(const_cast<char *>(password.data())),
              static_cast<ULONG>(password.size()), const_cast<PUCHAR>(salt.data()), static_cast<ULONG>(salt.size()),
              iterations, key.data(), static_cast<ULONG>(key.size()), 0), "Parola anahtarı türetilemedi.");
  return key;
}

struct CipherText { std::vector<UCHAR> ciphertext; std::vector<UCHAR> tag; };

CipherText encryptGcm(const std::string &plaintext, const std::vector<UCHAR> &key, const std::vector<UCHAR> &nonce) {
  AlgorithmHandle algorithm;
  checkStatus(BCryptOpenAlgorithmProvider(&algorithm.value, BCRYPT_AES_ALGORITHM, nullptr, 0), "Şifreleme başlatılamadı.");
  checkStatus(BCryptSetProperty(algorithm.value, BCRYPT_CHAINING_MODE,
              reinterpret_cast<PUCHAR>(const_cast<wchar_t *>(BCRYPT_CHAIN_MODE_GCM)), sizeof(BCRYPT_CHAIN_MODE_GCM), 0),
              "AES-GCM başlatılamadı.");
  ULONG objectLength = 0, returned = 0;
  checkStatus(BCryptGetProperty(algorithm.value, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&objectLength),
              sizeof(objectLength), &returned, 0), "AES anahtarı hazırlanamadı.");
  std::vector<UCHAR> keyObject(objectLength);
  CleanBytes cleanKeyObject{keyObject};
  KeyHandle keyHandle;
  checkStatus(BCryptGenerateSymmetricKey(algorithm.value, &keyHandle.value, keyObject.data(), objectLength,
              const_cast<PUCHAR>(key.data()), static_cast<ULONG>(key.size()), 0), "AES anahtarı hazırlanamadı.");
  CipherText result;
  result.ciphertext.resize(plaintext.size());
  result.tag.resize(kTagLength);
  BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO auth{};
  BCRYPT_INIT_AUTH_MODE_INFO(auth);
  auth.pbNonce = const_cast<PUCHAR>(nonce.data());
  auth.cbNonce = static_cast<ULONG>(nonce.size());
  auth.pbTag = result.tag.data();
  auth.cbTag = static_cast<ULONG>(result.tag.size());
  ULONG written = 0;
  const UCHAR *input = reinterpret_cast<const UCHAR *>(plaintext.data());
  UCHAR *output = result.ciphertext.empty() ? nullptr : result.ciphertext.data();
  checkStatus(BCryptEncrypt(keyHandle.value, const_cast<PUCHAR>(input), static_cast<ULONG>(plaintext.size()),
              &auth, nullptr, 0, output, static_cast<ULONG>(result.ciphertext.size()), &written, 0), "Kasa şifrelenemedi.");
  result.ciphertext.resize(written);
  return result;
}

std::string decryptGcm(const std::vector<UCHAR> &ciphertext, const std::vector<UCHAR> &key,
                       const std::vector<UCHAR> &nonce, const std::vector<UCHAR> &tag) {
  if (key.size() != kKeyLength || nonce.size() != kNonceLength || tag.size() != kTagLength)
    throw std::runtime_error("Kasa şifreleme alanları bozuk.");
  AlgorithmHandle algorithm;
  checkStatus(BCryptOpenAlgorithmProvider(&algorithm.value, BCRYPT_AES_ALGORITHM, nullptr, 0), "Kasa açılamadı.");
  checkStatus(BCryptSetProperty(algorithm.value, BCRYPT_CHAINING_MODE,
              reinterpret_cast<PUCHAR>(const_cast<wchar_t *>(BCRYPT_CHAIN_MODE_GCM)), sizeof(BCRYPT_CHAIN_MODE_GCM), 0),
              "Kasa açılamadı.");
  ULONG objectLength = 0, returned = 0;
  checkStatus(BCryptGetProperty(algorithm.value, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&objectLength),
              sizeof(objectLength), &returned, 0), "Kasa açılamadı.");
  std::vector<UCHAR> keyObject(objectLength);
  CleanBytes cleanKeyObject{keyObject};
  KeyHandle keyHandle;
  checkStatus(BCryptGenerateSymmetricKey(algorithm.value, &keyHandle.value, keyObject.data(), objectLength,
              const_cast<PUCHAR>(key.data()), static_cast<ULONG>(key.size()), 0), "Kasa açılamadı.");
  std::vector<UCHAR> mutableTag = tag;
  std::vector<UCHAR> plaintext(ciphertext.size());
  CleanBytes cleansePlaintext{plaintext};
  BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO auth{};
  BCRYPT_INIT_AUTH_MODE_INFO(auth);
  auth.pbNonce = const_cast<PUCHAR>(nonce.data());
  auth.cbNonce = static_cast<ULONG>(nonce.size());
  auth.pbTag = mutableTag.data();
  auth.cbTag = static_cast<ULONG>(mutableTag.size());
  ULONG written = 0;
  UCHAR *output = plaintext.empty() ? nullptr : plaintext.data();
  const NTSTATUS status = BCryptDecrypt(keyHandle.value, const_cast<PUCHAR>(ciphertext.data()),
      static_cast<ULONG>(ciphertext.size()), &auth, nullptr, 0, output, static_cast<ULONG>(plaintext.size()), &written, 0);
  if (status < 0) throw std::runtime_error("Parola hatalı veya kasa bozulmuş/kurcalanmış.");
  return std::string(reinterpret_cast<const char *>(plaintext.data()), written);
}

Json encryptedPayload(const std::string &plaintext, const std::vector<UCHAR> &key) {
  const auto nonce = randomBytes(kNonceLength);
  const auto encrypted = encryptGcm(plaintext, key, nonce);
  Json envelope = Json::makeObject();
  envelope["version"] = Json::makeNumber(1);
  envelope["cipher"] = Json::makeString("AES-256-GCM");
  envelope["kdf"] = Json::makeString("PBKDF2-HMAC-SHA256");
  envelope["iterations"] = Json::makeNumber(kIterations);
  envelope["nonce"] = Json::makeString(base64Encode(nonce));
  envelope["ciphertext"] = Json::makeString(base64Encode(encrypted.ciphertext));
  envelope["tag"] = Json::makeString(base64Encode(encrypted.tag));
  return envelope;
}

Json encryptWithSaltAndIterations(const std::string &plaintext, const std::vector<UCHAR> &key,
                                  const std::vector<UCHAR> &salt, ULONG iterations) {
  Json envelope = encryptedPayload(plaintext, key);
  envelope["salt"] = Json::makeString(base64Encode(salt));
  envelope["iterations"] = Json::makeNumber(iterations);
  return envelope;
}

std::pair<std::vector<UCHAR>, ULONG> kdfMetadata(const Json &envelope) {
  const Json *version = envelope.find("version");
  const Json *cipher = envelope.find("cipher");
  if (!version || version->kind != Json::Kind::Number || version->number != 1 || !cipher || !cipher->isString() ||
      cipher->text != "AES-256-GCM") throw std::runtime_error("Desteklenmeyen veya geçersiz kasa formatı.");
  const Json *saltValue = envelope.find("salt");
  if (!saltValue || !saltValue->isString()) throw std::runtime_error("Kasa KDF bilgileri geçersiz.");
  auto salt = base64Decode(saltValue->text);
  const ULONG iterations = fieldIterations(envelope);
  if (salt.size() != kSaltLength) throw std::runtime_error("Kasa KDF bilgileri geçersiz.");
  return {std::move(salt), iterations};
}

std::string decryptPayload(const Json &envelope, const std::vector<UCHAR> &key) {
  const Json *nonceValue = envelope.find("nonce"), *cipherValue = envelope.find("ciphertext"), *tagValue = envelope.find("tag");
  if (!nonceValue || !nonceValue->isString() || !cipherValue || !cipherValue->isString() || !tagValue || !tagValue->isString())
    throw std::runtime_error("Kasa şifreleme alanları bozuk.");
  return decryptGcm(base64Decode(cipherValue->text), key, base64Decode(nonceValue->text), base64Decode(tagValue->text));
}

Json readEnvelope(const fs::path &path) {
  std::ifstream input(path, std::ios::binary);
  if (!input) throw std::runtime_error("Kasa dosyası açılamadı: " + pathUtf8(path));
  input.seekg(0, std::ios::end);
  const std::streamoff size = input.tellg();
  if (size < 0 || static_cast<uint64_t>(size) > kMaxFileSize) throw std::runtime_error("Kasa dosyası geçersiz boyutta.");
  input.seekg(0, std::ios::beg);
  std::string bytes(static_cast<size_t>(size), '\0');
  if (!bytes.empty() && !input.read(bytes.data(), static_cast<std::streamsize>(bytes.size())))
    throw std::runtime_error("Kasa dosyası okunamadı.");
  Json result = JsonParser(bytes).parse();
  if (!result.isObject()) throw std::runtime_error("Kasa dosyası geçerli JSON değil.");
  return result;
}

void writeAtomic(const fs::path &path, const std::string &contents, bool backup) {
  if (contents.size() > kMaxFileSize) throw std::runtime_error("Kasa verisi çok büyük.");
  std::error_code ec;
  fs::create_directories(path.parent_path(), ec);
  if (ec) throw std::runtime_error("Kasa klasörü oluşturulamadı.");
  static const char hex[] = "0123456789abcdef";
  const auto random = randomBytes(12);
  std::string suffix;
  suffix.reserve(random.size() * 2);
  for (UCHAR byte : random) { suffix.push_back(hex[byte >> 4]); suffix.push_back(hex[byte & 0x0f]); }
  const fs::path temp = pathFromUtf8(pathUtf8(path) + ".tmp-" + suffix);
  HANDLE file = CreateFileW(temp.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) throw std::runtime_error("Geçici kasa dosyası oluşturulamadı.");
  bool writtenOk = true;
  size_t offset = 0;
  while (offset < contents.size()) {
    const DWORD amount = static_cast<DWORD>(std::min<size_t>(contents.size() - offset, 1024 * 1024));
    DWORD written = 0;
    if (!WriteFile(file, contents.data() + offset, amount, &written, nullptr) || written == 0) { writtenOk = false; break; }
    offset += written;
  }
  if (writtenOk) writtenOk = FlushFileBuffers(file) != 0;
  CloseHandle(file);
  if (!writtenOk) { DeleteFileW(temp.c_str()); throw std::runtime_error("Kasa dosyası diske yazılamadı."); }

  if (backup && fs::exists(path)) {
    fs::path bak = pathFromUtf8(pathUtf8(path) + ".bak");
    if (!CopyFileW(path.c_str(), bak.c_str(), FALSE)) { DeleteFileW(temp.c_str()); throw std::runtime_error("Önceki kasa yedeği yazılamadı."); }
  }
  if (!MoveFileExW(temp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
    DeleteFileW(temp.c_str());
    throw std::runtime_error("Kasa dosyası atomik olarak kaydedilemedi.");
  }
}

struct OpenResult { std::string plaintext; size_t accountCount = 0; };

OpenResult openAtPath(const fs::path &path, const std::string &password, bool keepKey) {
  const Json envelope = readEnvelope(path);
  auto [salt, iterations] = kdfMetadata(envelope);
  auto key = deriveKey(password, salt, iterations);
  CleanBytes cleanKey{key};
  std::string plaintext = decryptPayload(envelope, key);
  Json payload;
  try { payload = JsonParser(plaintext).parse(); }
  catch (...) { throw std::runtime_error("Kasa içeriği geçerli JSON değil."); }
  const Json *accounts = payload.find("accounts");
  if (!payload.isObject() || !accounts || !accounts->isArray()) throw std::runtime_error("Kasa hesap listesi içermiyor.");
  if (keepKey) {
    clearKey();
    gKey = std::move(key);
    gVaultPath = pathUtf8(path);
  }
  return {std::move(plaintext), accounts->array.size()};
}

void savePlaintext(const fs::path &path, const std::string &plaintext, const std::vector<UCHAR> &key) {
  const Json old = readEnvelope(path);
  const auto [salt, iterations] = kdfMetadata(old);
  const Json updated = encryptWithSaltAndIterations(plaintext, key, salt, iterations);
  writeAtomic(path, dumpJson(updated), true);
}

std::optional<fs::path> choosePath(bool save, const std::wstring &title, const std::wstring &defaultName) {
  IFileDialog *dialog = nullptr;
  const HRESULT created = CoCreateInstance(save ? CLSID_FileSaveDialog : CLSID_FileOpenDialog, nullptr,
      CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog));
  if (FAILED(created) || !dialog) throw std::runtime_error("Windows dosya seçicisi başlatılamadı.");
  struct DialogGuard { IFileDialog *dialog; ~DialogGuard() { if (dialog) dialog->Release(); } } guard{dialog};
  dialog->SetTitle(title.c_str());
  const COMDLG_FILTERSPEC filters[] = {{L"FiOTP kasa ve yedek (*.json)", L"*.json"}, {L"Tüm dosyalar", L"*.*"}};
  dialog->SetFileTypes(2, filters);
  dialog->SetDefaultExtension(L"json");
  if (save) dialog->SetFileName(defaultName.c_str());
  DWORD options = 0;
  if (SUCCEEDED(dialog->GetOptions(&options))) {
    options |= FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST;
    options |= save ? FOS_OVERWRITEPROMPT : FOS_FILEMUSTEXIST;
    dialog->SetOptions(options);
  }
  const HRESULT shown = dialog->Show(GetActiveWindow());
  if (shown == HRESULT_FROM_WIN32(ERROR_CANCELLED)) return std::nullopt;
  if (FAILED(shown)) throw std::runtime_error("Windows dosya seçicisi hata verdi.");
  IShellItem *item = nullptr;
  if (FAILED(dialog->GetResult(&item)) || !item) throw std::runtime_error("Seçilen dosya yolu alınamadı.");
  PWSTR rawPath = nullptr;
  const HRESULT pathResult = item->GetDisplayName(SIGDN_FILESYSPATH, &rawPath);
  item->Release();
  if (FAILED(pathResult) || !rawPath) throw std::runtime_error("Seçilen dosya yolu alınamadı.");
  std::wstring selected(rawPath);
  CoTaskMemFree(rawPath);
  return fs::path(selected);
}

std::string encodeResponse(bool ok, Json data = Json::makeObject(), const std::string &message = {}, const std::string &code = {}) {
  Json result = Json::makeObject();
  result["ok"] = Json::makeBool(ok);
  if (ok) result["data"] = std::move(data);
  else { result["error"] = Json::makeString(message); result["code"] = Json::makeString(code); }
  return dumpJson(result);
}

Json dataWithPath(const fs::path &path) {
  Json data = Json::makeObject();
  data["path"] = Json::makeString(pathUtf8(path));
  return data;
}

std::string copyToClipboard(const std::string &text) {
  const std::wstring wide = toWide(text);
  if (!OpenClipboard(GetActiveWindow())) return encodeResponse(false, {}, "Pano açılamadı.", "clipboard_failed");
  bool transferred = false;
  EmptyClipboard();
  const SIZE_T bytes = (wide.size() + 1) * sizeof(wchar_t);
  HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, bytes);
  if (memory) {
    void *destination = GlobalLock(memory);
    if (destination) {
      memcpy(destination, wide.c_str(), bytes);
      GlobalUnlock(memory);
      transferred = SetClipboardData(CF_UNICODETEXT, memory) != nullptr;
    }
    if (!transferred) GlobalFree(memory);
  }
  CloseClipboard();
  return transferred ? encodeResponse(true) : encodeResponse(false, {}, "Metin panoya kopyalanamadı.", "clipboard_failed");
}

std::string hmacDigest(const Json &args) {
  auto keyBytes = base64Decode(fieldString(args, "key"));
  CleanBytes cleanKey{keyBytes};
  const auto message = base64Decode(fieldString(args, "message"));
  const std::string algorithmName = fieldString(args, "algorithm", "SHA1");
  LPCWSTR algorithmNameWide = BCRYPT_SHA1_ALGORITHM;
  ULONG digestLength = 20;
  if (algorithmName == "SHA256") { algorithmNameWide = BCRYPT_SHA256_ALGORITHM; digestLength = 32; }
  else if (algorithmName == "SHA512") { algorithmNameWide = BCRYPT_SHA512_ALGORITHM; digestLength = 64; }
  else if (algorithmName != "SHA1") throw std::runtime_error("Desteklenmeyen HMAC algoritması.");
  AlgorithmHandle algorithm;
  checkStatus(BCryptOpenAlgorithmProvider(&algorithm.value, algorithmNameWide, nullptr, BCRYPT_ALG_HANDLE_HMAC_FLAG),
              "HMAC başlatılamadı.");
  ULONG objectLength = 0, returned = 0;
  checkStatus(BCryptGetProperty(algorithm.value, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&objectLength),
              sizeof(objectLength), &returned, 0), "HMAC başlatılamadı.");
  std::vector<UCHAR> object(objectLength), digest(digestLength);
  CleanBytes cleanHashObject{object};
  BCRYPT_HASH_HANDLE hash = nullptr;
  checkStatus(BCryptCreateHash(algorithm.value, &hash, object.data(), objectLength,
              keyBytes.empty() ? nullptr : keyBytes.data(), static_cast<ULONG>(keyBytes.size()), 0), "HMAC başlatılamadı.");
  struct HashGuard { BCRYPT_HASH_HANDLE value; ~HashGuard() { if (value) BCryptDestroyHash(value); } } hashGuard{hash};
  if (!message.empty()) checkStatus(BCryptHashData(hash, const_cast<PUCHAR>(message.data()), static_cast<ULONG>(message.size()), 0),
                                    "HMAC üretilemedi.");
  checkStatus(BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0), "HMAC üretilemedi.");
  Json data = Json::makeObject();
  data["digest"] = Json::makeString(base64Encode(digest));
  return encodeResponse(true, std::move(data));
}
}  // namespace

std::string fiotp_host_invoke(const std::string &method, const std::string &payload) {
  try {
    Json args = JsonParser(payload.empty() ? std::string("{}") : payload).parse();
    if (!args.isObject()) return encodeResponse(false, {}, "Geçersiz istek.", "invalid_request");
    if (method == "platform.info") {
      Json data = Json::makeObject(); data["platform"] = Json::makeString("windows");
      return encodeResponse(true, std::move(data));
    }
    if (method == "vault.defaultPath") return encodeResponse(true, dataWithPath(defaultVaultPath()));
    if (method == "vault.selectedPath") {
      std::string selected;
      try { selected = fieldString(readEnvelope(settingsPath()), "selectedVaultPath"); } catch (...) {}
      Json data = Json::makeObject(); data["path"] = Json::makeString(selected);
      return encodeResponse(true, std::move(data));
    }
    if (method == "vault.rememberPath") {
      const fs::path path = expandPath(fieldString(args, "path"));
      Json settings = Json::makeObject(); settings["selectedVaultPath"] = Json::makeString(pathUtf8(path));
      writeAtomic(settingsPath(), dumpJson(settings), false);
      return encodeResponse(true, dataWithPath(path));
    }
    if (method == "vault.status" || method == "vault.discover") {
      fs::path path;
      if (method == "vault.discover") {
        path = expandPath(fieldString(args, "preferredPath"));
        std::error_code ec;
        if (!fs::exists(path, ec)) path = defaultVaultPath();
      } else path = expandPath(fieldString(args, "path"));
      std::error_code ec;
      Json data = dataWithPath(path); data["exists"] = Json::makeBool(fs::exists(path, ec));
      return encodeResponse(true, std::move(data));
    }
    if (method == "vault.create") {
      const std::string password = fieldString(args, "password");
      if (password.size() < 8) return encodeResponse(false, {}, "Master parola en az 8 karakter olmalıdır.", "weak_password");
      const fs::path path = expandPath(fieldString(args, "path"));
      if (fs::exists(path)) return encodeResponse(false, {}, "Bu konumda zaten bir kasa var. Mevcut kasayı açın veya başka bir konum seçin.", "vault_exists");
      const auto salt = randomBytes(kSaltLength);
      auto key = deriveKey(password, salt, kIterations); CleanBytes cleanKey{key};
      const Json envelope = encryptWithSaltAndIterations(fieldString(args, "plaintext"), key, salt, kIterations);
      writeAtomic(path, dumpJson(envelope), true);
      clearKey(); gKey = std::move(key); gVaultPath = pathUtf8(path);
      return encodeResponse(true, dataWithPath(path));
    }
    if (method == "vault.open" || method == "vault.readExternal") {
      const fs::path path = expandPath(fieldString(args, "path"));
      const std::string password = fieldString(args, "password");
      const bool keep = method == "vault.open";
      try {
        const OpenResult opened = openAtPath(path, password, keep);
        Json data = Json::makeObject(); data["path"] = Json::makeString(pathUtf8(path));
        data["plaintext"] = Json::makeString(opened.plaintext);
        data["accountCount"] = Json::makeNumber(opened.accountCount);
        return encodeResponse(true, std::move(data));
      } catch (const std::exception &original) {
        if (keep) {
          try {
            const OpenResult recovered = openAtPath(pathFromUtf8(pathUtf8(path) + ".bak"), password, true);
            Json data = Json::makeObject(); data["path"] = Json::makeString(pathUtf8(path));
            data["plaintext"] = Json::makeString(recovered.plaintext);
            data["accountCount"] = Json::makeNumber(recovered.accountCount);
            data["recoveredFromBackup"] = Json::makeBool(true);
            gVaultPath = pathUtf8(path);
            return encodeResponse(true, std::move(data));
          } catch (...) {}
        }
        return encodeResponse(false, {}, original.what(), keep ? "open_failed" : "external_open_failed");
      }
    }
    if (method == "vault.save") {
      if (gKey.empty()) return encodeResponse(false, {}, "Kasa kilitli.", "locked");
      const fs::path path = expandPath(fieldString(args, "path", gVaultPath));
      savePlaintext(path, fieldString(args, "plaintext"), gKey);
      return encodeResponse(true);
    }
    if (method == "vault.lock") { clearKey(); return encodeResponse(true); }
    if (method == "vault.changePassword") {
      const fs::path path = expandPath(fieldString(args, "path", gVaultPath));
      openAtPath(path, fieldString(args, "currentPassword"), false);
      const std::string password = fieldString(args, "newPassword");
      if (password.size() < 8) return encodeResponse(false, {}, "Yeni parola en az 8 karakter olmalıdır.", "weak_password");
      const auto salt = randomBytes(kSaltLength);
      auto key = deriveKey(password, salt, kIterations); CleanBytes cleanKey{key};
      const Json envelope = encryptWithSaltAndIterations(fieldString(args, "plaintext"), key, salt, kIterations);
      writeAtomic(path, dumpJson(envelope), true);
      clearKey(); gKey = std::move(key); gVaultPath = pathUtf8(path);
      return encodeResponse(true);
    }
    if (method == "vault.export") {
      const fs::path source = expandPath(fieldString(args, "source"));
      const fs::path destination = expandPath(fieldString(args, "destination"));
      std::error_code ec; fs::create_directories(destination.parent_path(), ec);
      if (ec || !CopyFileW(source.c_str(), destination.c_str(), FALSE)) throw std::runtime_error("Şifreli yedek dosyası kopyalanamadı.");
      return encodeResponse(true, dataWithPath(destination));
    }
    if (method == "clipboard.copy") return copyToClipboard(fieldString(args, "text"));
    if (method == "crypto.hmac") return hmacDigest(args);
    if (method == "qr.scanCamera")
      return encodeResponse(false, {}, "Bu Windows hedefinde kamera ile QR tarama henüz desteklenmiyor. Hesabı otpauth:// URI ile ekleyebilirsiniz.", "camera_unavailable");
    if (method.rfind("dialog.", 0) == 0) {
      const bool save = method == "dialog.saveVault" || method == "dialog.saveBackup";
      const bool backup = method.find("Backup") != std::string::npos;
      const auto selected = choosePath(save, backup ? L"FiOTP şifreli yedeği" : L"FiOTP kasası",
                                       backup ? L"fiotp-backup.json" : L"kasa.json");
      if (!selected) return encodeResponse(false, {}, "İşlem iptal edildi.", "cancelled");
      return encodeResponse(true, dataWithPath(*selected));
    }
    return encodeResponse(false, {}, "Bilinmeyen Windows işlemi: " + method, "unknown_method");
  } catch (const std::exception &error) {
    return encodeResponse(false, {}, error.what(), "native_error");
  }
}

#ifndef FIOTP_HOST_STANDALONE
namespace {
std::string fiotp_host_thunk(void *, std::string method, std::string payload) {
  return fiotp_host_invoke(method, payload);
}
}
gea::CallableObject<std::string(std::string, std::string)> fiotpHostInvoke{fiotp_host_thunk, nullptr};
#endif

#endif  // _WIN32
