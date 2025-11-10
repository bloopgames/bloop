const std = @import("std");

pub fn to_hex(alloc: std.mem.Allocator, data: []const u8) []u8 {
    const hex_chars = "0123456789ABCDEF";
    var result = alloc.alloc(u8, data.len * 3) catch return &[_]u8{};
    for (data, 0..) |byte, data_index| {
        result[data_index * 3] = hex_chars[(byte >> 4) & 0x0F];
        result[data_index * 3 + 1] = hex_chars[byte & 0x0F];
        result[data_index * 3 + 2] = ' ';
    }
    return result;
}
