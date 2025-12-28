const std = @import("std");
const Events = @import("events.zig");

fn writeTsEnum(writer: anytype, comptime T: type, comptime name: []const u8) !void {
    try writer.interface.print("export enum {s} {{\n", .{name});

    const info = @typeInfo(T).@"enum";
    inline for (info.fields) |field| {
        const val = field.value;
        try writer.interface.print("  {s} = {d},\n", .{ field.name, val });
    }

    try writer.interface.print("}}\n\n", .{});
}

pub fn main() !void {
    var threaded: std.Io.Threaded = .init_single_threaded;
    const io = threaded.io();

    const cwd = std.Io.Dir.cwd();
    try cwd.makePath(io, "js/codegen");
    var file = try cwd.createFile(io, "js/codegen/enums.ts", .{});
    defer file.close(io);

    var buf: [1024]u8 = undefined;
    var writer = file.writer(&buf);

    try writer.interface.print("// AUTO-GENERATED FILE - DO NOT MODIFY\n\n", .{});

    try writeTsEnum(&writer, Events.EventType, "EventType");
    try writeTsEnum(&writer, Events.MouseButton, "MouseButton");
    try writeTsEnum(&writer, Events.Key, "Key");
    try writeTsEnum(&writer, Events.InputSource, "InputSource");
    try writer.interface.flush();
}
