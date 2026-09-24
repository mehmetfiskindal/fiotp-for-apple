#include "gea_runtime.h"
#include "services/storage_service.h"

#include <cstdint>
#include <cstring>
#include <string>
#include <utility>

namespace {

std::string g_last_blob;

std::string serializeEntries()
{
	const auto &entries = gea::host::storage::table();
	std::string out;
	for (const auto &entry : entries) {
		for (const std::string *part : {&entry.first, &entry.second}) {
			const std::uint32_t len = static_cast<std::uint32_t>(part->size());
			char header[sizeof(len)];
			std::memcpy(header, &len, sizeof(len));
			out.append(header, sizeof(header));
			out.append(*part);
		}
	}
	return out;
}

} // namespace

extern "C" void rpios_runtime_storage_load()
{
	std::string blob;
	gea::framework::services::StorageService::loadKv(blob);
	auto &entries = gea::host::storage::table();
	entries.clear();
	std::size_t pos = 0;
	auto readChunk = [&](std::string &out) {
		if (pos + sizeof(std::uint32_t) > blob.size()) return false;
		std::uint32_t len = 0;
		std::memcpy(&len, blob.data() + pos, sizeof(len));
		pos += sizeof(len);
		if (pos + len > blob.size()) return false;
		out.assign(blob.data() + pos, len);
		pos += len;
		return true;
	};
	std::string key, value;
	while (readChunk(key) && readChunk(value)) entries[key] = value;
	g_last_blob = blob;
}

extern "C" void rpios_runtime_storage_flush()
{
	std::string blob = serializeEntries();
	if (blob == g_last_blob) return;
	gea::framework::services::StorageService::saveKv(blob);
	g_last_blob.swap(blob);
}
