// Root module for running all engine tests
// Usage: zig build test (runs tests from all imported modules)

comptime {
    // Core modules
    _ = @import("sim.zig");
    _ = @import("tapes.zig");
    _ = @import("vcr.zig");
    _ = @import("input_buffer.zig");

    // Netcode modules
    _ = @import("netcode/transport.zig");
    _ = @import("netcode/session.zig");
}
