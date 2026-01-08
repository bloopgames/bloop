const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.resolveTargetQuery(.{ .cpu_arch = .wasm32, .os_tag = .freestanding });
    const optimize = b.standardOptimizeOption(.{ .preferred_optimize_mode = .ReleaseSmall });

    const root_module = b.createModule(.{
        .root_source_file = b.path("src/wasm.zig"),
        .target = target,
        .optimize = optimize,
    });

    const exe = b.addExecutable(.{
        .name = "bloop",
        .root_module = root_module,
    });

    exe.entry = .disabled;

    // Explicitly export WASM functions (instead of rdynamic which exports all symbols)
    exe.root_module.export_symbol_names = &.{
        "initialize",
        "deinit",
        "alloc",
        "free",
        "step",
        "tick",
        "seek",
        "register_systems",
        // Recording/playback
        "start_recording",
        "stop_recording",
        "is_recording",
        "is_replaying",
        "get_tape_ptr",
        "get_tape_len",
        "load_tape",
        // Snapshots
        "take_snapshot",
        "restore",
        // Input events
        "emit_keydown",
        "emit_keyup",
        "emit_mousedown",
        "emit_mouseup",
        "emit_mousemove",
        "emit_mousewheel",
        // Platform events
        "emit_resize",
        // Context accessors
        "get_time_ctx",
        "get_net_ctx",
        "get_screen_ctx",
        "get_events_ptr",
        // Session / Rollback
        "session_end",
        // Network / Packets
        "build_outbound_packet",
        "get_outbound_packet",
        "get_outbound_packet_len",
        "emit_receive_packet",
        // Network events
        "emit_net_join_ok",
        "emit_net_join_fail",
        "emit_net_peer_join",
        "emit_net_peer_leave",
        "emit_net_peer_assign_local_id",
        // Event-based session API
        "emit_net_session_init",
        "emit_net_session_end",
    };

    // read memory from JS side
    exe.import_memory = true;
    exe.export_memory = false;

    const codegen = b.addExecutable(.{
        .name = "codegen",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/codegen.zig"),
            .target = b.graph.host,
            .optimize = .Debug,
        }),
    });
    const codegen_step = b.addRunArtifact(codegen);
    exe.step.dependOn(&codegen_step.step);

    const install = b.addInstallArtifact(exe, .{
        .dest_sub_path = "bloop.wasm",
    });
    install.dest_dir = .{ .custom = "wasm" };

    b.getInstallStep().dependOn(&install.step);

    const tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/root.zig"),
            .target = b.graph.host,
            .optimize = .Debug,
        }),
    });
    const run_tests = b.addRunArtifact(tests);

    const test_step = b.step("test", "Run tests");
    test_step.dependOn(&run_tests.step);
}
