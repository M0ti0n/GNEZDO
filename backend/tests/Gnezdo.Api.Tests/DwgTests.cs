using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace Gnezdo.Api.Tests;

/// <summary>DWG import: converted to DXF by a converter on the server (a stand-in dwg2dxf here).</summary>
public sealed class DwgTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task A_dwg_is_converted_by_the_servers_converter()
    {
        if (OperatingSystem.IsWindows()) return;   // the stand-in converter is a shell script
        var was = Environment.GetEnvironmentVariable("GNEZDO_DWG_CONVERTER");
        var dir = Directory.CreateTempSubdirectory("gnezdo-dwg-test-").FullName;
        try
        {
            Environment.SetEnvironmentVariable("GNEZDO_DWG_CONVERTER", Path.Combine(dir, "missing"));
            var none = await api.Client.GetFromJsonAsync<JsonObject>("/api/import/dwg");
            if (none!["available"]!.GetValue<bool>()) return;   // a real converter on this PC: nothing to check without one
            var refused = await api.Client.PostAsync("/api/import/dwg", new ByteArrayContent([1, 2, 3]));
            Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);

            // dwg2dxf -y -o OUT IN: the stand-in copies IN to OUT
            var tool = Path.Combine(dir, "dwg2dxf");
            await File.WriteAllTextAsync(tool, "#!/bin/sh\ncp \"$4\" \"$3\"\n");
            File.SetUnixFileMode(tool, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            Environment.SetEnvironmentVariable("GNEZDO_DWG_CONVERTER", tool);
            var yes = await api.Client.GetFromJsonAsync<JsonObject>("/api/import/dwg");
            Assert.True(yes!["available"]!.GetValue<bool>());
            Assert.Equal("LibreDWG dwg2dxf", yes["converter"]!.GetValue<string>());
            var res = await api.Client.PostAsync("/api/import/dwg", new StringContent("0\nSECTION\n0\nEOF\n"));
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            Assert.Equal("0\nSECTION\n0\nEOF\n", await res.Content.ReadAsStringAsync());

            // a converter that writes nothing: why, not a crash
            await File.WriteAllTextAsync(tool, "#!/bin/sh\necho bad file >&2\nexit 1\n");
            var bad = await api.Client.PostAsync("/api/import/dwg", new StringContent("x"));
            Assert.Equal(HttpStatusCode.UnprocessableEntity, bad.StatusCode);
            Assert.Contains("bad file", await bad.Content.ReadAsStringAsync());
        }
        finally
        {
            Environment.SetEnvironmentVariable("GNEZDO_DWG_CONVERTER", was);
            try { Directory.Delete(dir, true); } catch (IOException) { }
        }
    }
}
