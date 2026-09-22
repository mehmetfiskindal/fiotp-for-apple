#pragma once

#include <string>
#ifndef FIOTP_HOST_STANDALONE
#include "gea_runtime.h"
#endif

std::string fiotp_host_invoke(const std::string &method, const std::string &payload);
#ifndef FIOTP_HOST_STANDALONE
extern gea::CallableObject<std::string(std::string, std::string)> fiotpHostInvoke;
#endif
