// Root module for running all engine tests
// Usage: zig build test (runs tests from all imported modules)

comptime {
    // Core modules
    _ = @import("sim.zig");
    _ = @import("input_buffer.zig");

    // Tapes modules
    _ = @import("tapes/tapes.zig");
    _ = @import("tapes/vcr.zig");

    // Netcode modules
    _ = @import("netcode/transport.zig");
    _ = @import("netcode/session.zig");
}
