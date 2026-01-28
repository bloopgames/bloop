const std = @import("std");
const Events = @import("events.zig");
const Context = @import("context.zig");

fn writeTsEnum(writer: anytype, comptime T: type, comptime name: []const u8) !void {
    try writer.interface.print("export enum {s} {{\n", .{name});

    const info = @typeInfo(T).@"enum";
    inline for (info.fields) |field| {
        const val = field.value;
        try writer.interface.print("  {s} = {d},\n", .{ field.name, val });
    }

    try writer.interface.print("}}\n\n", .{});
}

fn writeStructOffsets(writer: anytype, comptime T: type, comptime prefix: []const u8) !void {
    const info = @typeInfo(T).@"struct";
    inline for (info.fields) |field| {
        // Skip padding fields (start with _)
        if (field.name[0] != '_') {
            try writer.interface.print("export const {s}_", .{prefix});
            try writeScreamingSnake(writer, field.name);
            try writer.interface.print("_OFFSET = {d};\n", .{@offsetOf(T, field.name)});
        }
    }
    try writer.interface.print("export const {s}_SIZE = {d};\n\n", .{ prefix, @sizeOf(T) });
}

fn writeScreamingSnake(writer: anytype, name: []const u8) !void {
    for (name) |c| {
        if (c >= 'a' and c <= 'z') {
            try writer.interface.print("{c}", .{c - 32}); // Convert to uppercase
        } else if (c == '_') {
            try writer.interface.print("_", .{});
        } else {
            try writer.interface.print("{c}", .{c});
        }
    }
}

pub fn main() !void {
    try std.fs.cwd().makePath("js/codegen");

    // Generate enums.ts
    {
        var file = try std.fs.cwd().createFile("js/codegen/enums.ts", .{});
        defer file.close();

        var buf: [1024]u8 = undefined;
        var writer = file.writer(&buf);

        try writer.interface.print("// AUTO-GENERATED FILE - DO NOT MODIFY\n\n", .{});

        try writeTsEnum(&writer, Events.EventType, "EventType");
        try writeTsEnum(&writer, Events.MouseButton, "MouseButton");
        try writeTsEnum(&writer, Events.Key, "Key");
        try writeTsEnum(&writer, Events.InputSource, "InputSource");
        try writeTsEnum(&writer, Events.NetJoinFailReason, "NetJoinFailReason");
        try writer.interface.flush();
    }

    // Generate offsets.ts
    {
        var file = try std.fs.cwd().createFile("js/codegen/offsets.ts", .{});
        defer file.close();

        var buf: [1024]u8 = undefined;
        var writer = file.writer(&buf);

        try writer.interface.print("// AUTO-GENERATED FILE - DO NOT MODIFY\n\n", .{});

        try writeStructOffsets(&writer, Context.TimeCtx, "TIME_CTX");
        try writeStructOffsets(&writer, Context.PeerCtx, "PEER_CTX");
        try writeStructOffsets(&writer, Context.NetCtx, "NET_CTX");
        try writeStructOffsets(&writer, Context.ScreenCtx, "SCREEN_CTX");
        try writeStructOffsets(&writer, Context.RandCtx, "RAND_CTX");
        try writeStructOffsets(&writer, Context.MouseCtx, "MOUSE_CTX");
        try writeStructOffsets(&writer, Context.KeyCtx, "KEY_CTX");
        try writeStructOffsets(&writer, Context.PlayerInputs, "PLAYER_INPUTS");
        try writeStructOffsets(&writer, Context.InputCtx, "INPUT_CTX");
        try writeStructOffsets(&writer, Context.VcrCtx, "VCR_CTX");

        // Also export MAX_PLAYERS as it's a domain constant used in layouts
        try writer.interface.print("export const MAX_PLAYERS = {d};\n", .{Context.MAX_PLAYERS});

        try writer.interface.flush();
    }
}
