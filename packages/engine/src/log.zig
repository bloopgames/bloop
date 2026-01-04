// log.zig
const std = @import("std");

var initialized = false;
var arena: std.mem.Allocator = undefined;
var log_fn: *const fn ([]const u8) void = undefined;

pub fn init(arena_param: std.mem.Allocator, log_fn_param: fn ([]const u8) void) void {
    arena = arena_param;
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
    if (!initialized) {
        return;
    }

    _ = fmt;
    _ = args;
    // const msg = std.fmt.allocPrint(arena, fmt, args) catch {
    //     log_fn(fmt);
    //     return;
    // };
    // log_fn(msg);
}
