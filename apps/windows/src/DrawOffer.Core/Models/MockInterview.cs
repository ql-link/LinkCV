using System.Text.Json.Nodes;
using DrawOffer.Core.Api;
using System.Net;
namespace DrawOffer.Core.Models;
public static class MockInterviewRequest {
    public static bool Allowed(string path,string method) {
        if(path=="/api/mock-interviews")return method is "GET" or "POST";
        if(path=="/api/datasets")return method=="GET";
        var p=path.Split('/');if(p.Length is not (4 or 5)||p[0]!=""||p[1]!="api"||p[2]!="mock-interviews"||!Guid.TryParseExact(p[3],"D",out var id)||id.ToString("D")!=p[3])return false;
        return p.Length==4?method is "GET" or "DELETE":method=="POST"&&new[]{"answers","skip","reply:retry","finish","abandon","retry","repeat"}.Contains(p[4]);
    }
    public static JsonNode DecodeEvents(string source) {
        if(System.Text.Encoding.UTF8.GetByteCount(source)>4*1024*1024)throw new InvalidDataException();
        var events=new JsonArray();
        foreach(var block in source.Replace("\r\n","\n").Split("\n\n")) {
            var kind="";var lines=new List<string>();foreach(var line in block.Split('\n')){if(line.StartsWith("event:"))kind=line[6..].Trim();if(line.StartsWith("data:"))lines.Add(line[5..].Trim());}
            if(lines.Count==0)continue;var value=JsonNode.Parse(string.Join("\n",lines))??throw new InvalidDataException();
            if(kind=="interviewer.failed")throw new ApiException(HttpStatusCode.BadGateway,value["error"]?.GetValue<string>()??"MOCK_INTERVIEW_TURN_FAILED");
            events.Add(new JsonObject{["event"]=kind,["data"]=value});
        }
        if(events.Count==0)throw new InvalidDataException();return new JsonObject{["events"]=events};
    }
}
public sealed record MockInterview(JsonNode Raw) {
    public string Text(string key)=>Raw[key]?.GetValue<string>()??"";
    public string Id=>Text("id");public string Status=>Text("status");
    public bool Active=>new[]{"preparing","in_progress","evaluating"}.Contains(Status);
    public string Title=>Text("company_name")==""?Text("resume_title")+" · 通用面试":Text("company_name")+" · "+Text("job_title");
    public JsonArray Questions=>Raw["questions"]?.AsArray()??[];
    public JsonNode? Current=>Questions.FirstOrDefault(x=>x?["id"]?.GetValue<string>()==Text("current_question_id")&&x?["answer_status"]?.GetValue<string>()=="pending");
    public string Label=>StatusLabels.GetValueOrDefault(Status,Status);
    public string Type=>Types.GetValueOrDefault(Text("interview_type"),"综合面");
    public static readonly Dictionary<string,string> Types=new(){{"technical","技术面"},{"project_deep_dive","项目深挖"},{"comprehensive","综合面"},{"hr","HR 面"}};
    public static readonly Dictionary<string,string> Dimensions=new(){{"professional_depth","专业深度"},{"structure","表达结构"},{"job_fit","岗位匹配"},{"resume_consistency","简历一致性"},{"communication","沟通表现"},{"knowledge","知识与原理"},{"problem_solving","方案与权衡"},{"ownership","项目主导与成果"},{"motivation","动机与稳定性"}};
    public static readonly Dictionary<string,string> StatusLabels=new(){{"preparing","准备中"},{"preparation_failed","准备失败"},{"in_progress","面试中"},{"evaluating","评估中"},{"evaluation_failed","评估失败"},{"completed","已完成"},{"abandoned","已放弃"}};
}
