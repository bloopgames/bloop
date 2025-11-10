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
    try std.fs.cwd().makePath("js/codegen");
    var file = try std.fs.cwd().createFile("js/codegen/enums.ts", .{});
    defer file.close();

    var buf: [1024]u8 = undefined;
    var writer = file.writer(&buf);

    try writer.interface.print("// AUTO-GENERATED FILE - DO NOT MODIFY\n\n", .{});

    try writeTsEnum(&writer, Events.EventType, "EventType");
    try writeTsEnum(&writer, Events.MouseButton, "MouseButton");
    try writeTsEnum(&writer, Events.Key, "Key");
    try writer.interface.flush();
}
