const declarations = [
  '#include <string>',
  '#include "fiotp_host.h"',
]

export default function fiotpHostPlugin() {
  return {
    name: 'fiotp-host',
    configure() {
      return {
        hostShims: {
          embeddedHostFunctions: {
            fiotpHostInvoke: 'fiotp_host_invoke',
          },
          embeddedHostFunctionReturnTypes: {
            fiotpHostInvoke: 'std::string',
          },
          hostExternDeclarations: {
            fiotp_host_invoke: declarations,
          },
        },
      }
    },
  }
}

