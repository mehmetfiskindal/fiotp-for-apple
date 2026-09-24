#pragma once

// The Raspberry Pi OS target builds one app per executable. The current
// GeaStack packages no longer ship the old ResidentApps registry used by the
// target's animation scan hook, so null selects its documented single-app
// fallback path.
namespace gea::framework::apps {

class ResidentApps {
public:
	static const char *activeId() { return nullptr; }
};

} // namespace gea::framework::apps
