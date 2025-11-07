const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.resolveTargetQuery(.{ .cpu_arch = .wasm32, .os_tag = .freestanding });
    const optimize = std.builtin.OptimizeMode.ReleaseSmall;

    const exe = b.addExecutable(.{
        .name = "bloop",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/bloop.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });

    exe.entry = .disabled;

    // this is needed to export functions properly
    exe.rdynamic = true;

    const install = b.addInstallArtifact(exe, .{
        .dest_sub_path = "bloop.wasm",
    });
    install.dest_dir = .{ .custom = "js" };

    b.getInstallStep().dependOn(&install.step);

    const exe_tests = b.addTest(.{
        .root_module = exe.root_module,
    });

    const run_exe_tests = b.addRunArtifact(exe_tests);

    const test_step = b.step("test", "Run tests");
    test_step.dependOn(&run_exe_tests.step);
}
