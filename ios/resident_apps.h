#pragma once

#include <cstddef>

// The FiOTP bundle is a single-app iOS target, not the optional Gea resident
// app launcher. This compatibility surface lets the shared iOS runner keep its
// launcher hooks disabled without depending on a geaos-only source file.
namespace gea::framework::apps {
struct ResidentApps {
  static bool isEnabled() { return false; }
  static void requestLaunch(const char *) {}
  static const char *activeId() { return nullptr; }
  static bool consumeLaunch(char *, std::size_t) { return false; }
  static bool select(const char *) { return false; }
};
}
