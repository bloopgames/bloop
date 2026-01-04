// log.zig
const std = @import("std");

var initialized = false;
var arena: std.mem.Allocator = undefined;
var log_fn: *const fn ([]const u8) void = undefined;
var is_verbose: bool = false;

pub fn init(arena_param: std.mem.Allocator, is_verbose_param: bool, log_fn_param: fn ([]const u8) void) void {
    arena = arena_param;
    is_verbose = is_verbose_param;
    log_fn = log_fn_param;
    initialized = true;
}

pub fn log(comptime fmt: []const u8, args: anytype) void {
    if (!initialized) {
        return;
    }

    const msg = std.fmt.allocPrint(arena, fmt, args) catch {
        log_fn(fmt);
        return;
    };
    log_fn(msg);
}

pub fn debug(comptime fmt: []const u8, args: anytype) void {
    if (!is_verbose) {
        return;
    }
    if (!initialized) {
        return;
    }

    const msg = std.fmt.allocPrint(arena, fmt, args) catch {
        log_fn(fmt);
        return;
    };
    log_fn(msg);
}
