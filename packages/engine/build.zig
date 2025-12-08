const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.resolveTargetQuery(.{ .cpu_arch = .wasm32, .os_tag = .freestanding });
    const optimize = b.standardOptimizeOption(.{ .preferred_optimize_mode = .ReleaseSmall });

    const exe = b.addExecutable(.{
        .name = "bloop",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/engine.zig"),
            .target = target,
            .optimize = optimize,
        }),
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
        // Context accessors
        "get_time_ctx",
        "get_events_ptr",
        // Session / Rollback
        "session_init",
        "session_end",
        "session_emit_inputs",
        "get_match_frame",
        "get_confirmed_frame",
        "get_peer_frame",
        "get_rollback_depth",
        // Network / Packets
        "session_set_local_peer",
        "session_peer_connect",
        "session_peer_disconnect",
        "build_outbound_packet",
        "get_outbound_packet",
        "get_outbound_packet_len",
        "receive_packet",
        "get_peer_seq",
        "get_peer_ack",
        "get_unacked_count",
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

    const snapshot_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/tapes.zig"),
            .target = b.graph.host,
            .optimize = .Debug,
        }),
    });
    const run_snapshot_tests = b.addRunArtifact(snapshot_tests);

    const rollback_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/rollback.zig"),
            .target = b.graph.host,
            .optimize = .Debug,
        }),
    });
    const run_rollback_tests = b.addRunArtifact(rollback_tests);

    const sim_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/sim.zig"),
            .target = b.graph.host,
            .optimize = .Debug,
        }),
    });
    const run_sim_tests = b.addRunArtifact(sim_tests);

    const packets_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/packets.zig"),
            .target = b.graph.host,
            .optimize = .Debug,
        }),
    });
    const run_packets_tests = b.addRunArtifact(packets_tests);

    const test_step = b.step("test", "Run tests");
    test_step.dependOn(&run_snapshot_tests.step);
    test_step.dependOn(&run_rollback_tests.step);
    test_step.dependOn(&run_sim_tests.step);
    test_step.dependOn(&run_packets_tests.step);
}
