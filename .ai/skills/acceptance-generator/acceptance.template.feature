# 这是写法参考，不是可直接复制的需求内容。
# 每个 Scenario 必须来自冻结的 brief，并使用可观察、可断言的结果。

Feature: <可观察的业务能力>

  Background:
    Given <多个场景共有的可建立前置状态>

  Scenario: <主流程名称>
    Given <该规则特有的前置状态>
    When <用户或系统动作>
    Then <可断言的状态、响应或持久化结果>

  Scenario: <权限、异常或边界名称>
    Given <异常或边界前置>
    When <触发动作>
    Then <明确的错误码、状态或未发生的副作用>

  Scenario Outline: <同一规则的参数化边界>
    Given <公共前置>
    When <输入为 <input>>
    Then <结果为 <result>>

    Examples:
      | input | result |
      |       |        |
