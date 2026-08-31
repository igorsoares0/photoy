#include <cstdio>
#include <exception>

#include "core/error.h"
#include "core/log.h"
#include "engine/engine.h"
#include "protocol/frame.h"
#include "protocol/stdio_transport.h"

/**
 * Entry point for the Photoy native engine.
 *
 * The engine runs as a child process of the Electron main process and speaks
 * the length-prefixed frame protocol on stdin/stdout. Running out of process
 * keeps it independent of Electron's ABI, lets it be driven from a terminal for
 * testing, and means a decoder crash loses the engine, not the window.
 */
int main() {
  photoy::log::InitFromEnvironment();
  photoy::log::Info(std::string(photoy::kEngineName) + " " + photoy::kEngineVersion + " ready");

  photoy::protocol::StdioTransport transport;
  photoy::Engine engine(transport);

  photoy::protocol::Frame request;
  while (true) {
    try {
      if (!transport.Read(request)) break;  // host closed the pipe
    } catch (const photoy::EngineException& failure) {
      // A malformed frame means the stream is no longer trustworthy: there is
      // no safe resynchronisation point, so report and exit.
      photoy::log::Error(std::string("protocol error: ") + failure.detail());
      return 2;
    }

    const std::string type = request.header.value("type", std::string{});
    if (type != "request") {
      photoy::log::Warn("ignoring frame of type " + type);
      continue;
    }

    engine.Dispatch(request.header, request.payload);
  }

  // Draining the queue before returning lets every outstanding job report back,
  // so the host never sees a request silently go unanswered.
  engine.Shutdown();

  photoy::log::Info("engine stopped");
  return 0;
}
