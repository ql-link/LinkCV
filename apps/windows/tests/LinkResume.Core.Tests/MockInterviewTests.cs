using System.Text.Json.Nodes;
using LinkResume.Core.Models;
using LinkResume.Core.Api;
using Xunit;
namespace LinkResume.Core.Tests;
public class MockInterviewTests {
    [Fact] public void NarrowSurfaceRejectsSpeechTraversalAndDatasetWrites() {
        const string path="/api/mock-interviews/01234567-89ab-4cde-8fab-0123456789ab";
        foreach(var command in new[]{"answers","skip","reply:retry","finish","abandon","retry","repeat"})Assert.True(CareerRequest.Allowed(path+"/"+command,"POST"));
        Assert.True(CareerRequest.Allowed(path,"DELETE"));
        foreach(var invalid in new[]{path+"/speech",path+"/transcripts",path+"/../repeat",path+"/",path.ToUpperInvariant(),"/api/mock-interviews/speech-capability"})Assert.False(CareerRequest.Allowed(invalid,"POST"));
        Assert.True(CareerRequest.Allowed("/api/datasets","GET"));Assert.False(MockInterviewRequest.Allowed("/api/datasets","POST"));Assert.False(MockInterviewRequest.Allowed("/api/datasets/1","GET"));
    }
    [Fact] public void DecodeReplayMultilineAndFailure() {
        var result=MockInterviewRequest.DecodeEvents("event: answer.accepted\r\ndata: {\r\ndata: \"question_id\":\"1\"}\r\n\r\n");Assert.Equal("1",result["events"]![0]!["data"]!["question_id"]!.GetValue<string>());
        var error=Assert.Throws<ApiException>(()=>MockInterviewRequest.DecodeEvents("event: interviewer.failed\ndata: {\"error\":\"TURN_FAILED\"}\n\n"));Assert.Equal("TURN_FAILED",error.Code);
        Assert.Throws<InvalidDataException>(()=>MockInterviewRequest.DecodeEvents(": heartbeat\n\n"));Assert.Throws<InvalidDataException>(()=>MockInterviewRequest.DecodeEvents(new string(' ',4*1024*1024+1)));
    }
    [Fact] public void CurrentQuestionMustBePending() {
        var item=new MockInterview(JsonNode.Parse("""{"current_question_id":"2","status":"evaluation_failed","questions":[{"id":"2","answer_status":"answered"}]}""")!);Assert.Null(item.Current);Assert.False(item.Active);Assert.Equal("评估失败",item.Label);
    }

    [Fact] public async Task RealHttpAnswerUsesHeaderAndNeverForwardsMetadataOrRedirect() {
        using var listener=new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback,0);listener.Start();
        var origin=new Uri($"http://127.0.0.1:{((System.Net.IPEndPoint)listener.LocalEndpoint).Port}/");
        using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(15));var requests=new List<string>();
        var server=Task.Run(async()=>{for(var index=0;index<2;index++){
            using var socket=await listener.AcceptTcpClientAsync(timeout.Token);await using var stream=socket.GetStream();var bytes=new byte[8192];var text="";
            while(!text.Contains("\r\n\r\n")){var read=await stream.ReadAsync(bytes,timeout.Token);if(read==0)break;text+=System.Text.Encoding.UTF8.GetString(bytes,0,read);}
            var split=text.IndexOf("\r\n\r\n",StringComparison.Ordinal);var header=text[..split];var lengthLine=header.Split("\r\n").FirstOrDefault(x=>x.StartsWith("Content-Length:",StringComparison.OrdinalIgnoreCase));var length=lengthLine is null?0:int.Parse(lengthLine.Split(':')[1].Trim());
            while(System.Text.Encoding.UTF8.GetByteCount(text[(split+4)..])<length){var read=await stream.ReadAsync(bytes,timeout.Token);if(read==0)break;text+=System.Text.Encoding.UTF8.GetString(bytes,0,read);}if(lengthLine is null)while(!text.EndsWith("\r\n0\r\n\r\n",StringComparison.Ordinal)){var read=await stream.ReadAsync(bytes,timeout.Token);if(read==0)break;text+=System.Text.Encoding.UTF8.GetString(bytes,0,read);}requests.Add(text);
            const string body="event: answer.accepted\ndata: {\"question_id\":\"1\"}\n\n";var status=index==0?"200 OK":$"302 Found\r\nLocation: {origin}api/redirect-target";
            var response=System.Text.Encoding.UTF8.GetBytes($"HTTP/1.1 {status}\r\nSet-Cookie: private=secret; Path=/\r\nContent-Type: text/event-stream\r\nContent-Length: {System.Text.Encoding.UTF8.GetByteCount(body)}\r\nConnection: close\r\n\r\n{body}");await stream.WriteAsync(response,timeout.Token);
        }},timeout.Token);
        using var transport=new DesktopTransport(origin,allowLocalHttp:true);var key=Guid.NewGuid().ToString("D");var payload=new JsonObject{["__idempotency_key"]=key,["question_id"]="1",["answer"]="fictional answer"};
        const string path="/api/mock-interviews/01234567-89ab-4cde-8fab-0123456789ab/answers";
        var result=await transport.CareerAsync(path,"POST",new(),payload,"fixture-access",timeout.Token);Assert.Single(result["events"]!.AsArray());
        var error=await Assert.ThrowsAsync<ApiException>(()=>transport.CareerAsync(path,"POST",new(),payload,"fixture-access",timeout.Token));Assert.Equal(System.Net.HttpStatusCode.Found,error.Status);await server;
        Assert.Equal(2,requests.Count);Assert.All(requests,text=>{Assert.Contains(key,text);Assert.DoesNotContain("__idempotency_key",text);Assert.DoesNotContain("\r\nCookie:",text,StringComparison.OrdinalIgnoreCase);});
    }
}
