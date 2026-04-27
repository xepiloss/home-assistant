# Commax Wallpad Add-on

Commax 월패드를 Home Assistant에 연결하기 위한 애드온입니다.

EW11 시리얼-이더넷 장비를 통해 월패드와 통신하며, 조명/난방/환기/대기전력/검침/주차/공기질/생활정보/월패드 시간을 Home Assistant에 자동으로 등록합니다.

## 할 수 있는 것

- 조명 전원 제어
- 밝기 조절 지원 조명의 밝기 제어
- 난방 모드와 목표 온도 제어
- 환기 전원, 모드, 풍량 제어
- 대기전력 콘센트 전원, 자동 모드, 차단값 제어
- 일괄소등 상태 확인 및 제어
- 주차 위치와 차량 번호 확인
- CO2, PM2.5, PM10 공기질 확인
- 수도, 전기, 온수, 난방, 가스 검침 확인
- 이번 달 검침 사용량 확인
- 월패드 시간 확인
- 실외 현재 날씨, 온도, 습도 확인
- 실외 미세먼지 확인
- 예보 날씨와 최고/최저 온도 확인

## 필요한 것

- Home Assistant
- MQTT Broker
- EW11 또는 호환 시리얼-이더넷 장비
- Commax 월패드와 EW11 사이의 시리얼 연결

검침 장비가 월패드 제어 장비와 분리되어 있다면 EW11을 2개 사용할 수 있습니다.

## 설치 후 설정

Home Assistant 애드온 설정 화면에서 아래 값을 입력합니다.

| 옵션 | 설명 |
| --- | --- |
| `mqtt_topic_prefix` | MQTT 토픽 앞부분입니다. 기본값은 `devcommax`입니다. |
| `mqtt_broker_url` | MQTT Broker 주소입니다. |
| `mqtt_port` | MQTT Broker 포트입니다. 보통 `1883`입니다. |
| `mqtt_username` | MQTT 사용자 이름입니다. |
| `mqtt_password` | MQTT 비밀번호입니다. |
| `ew11_host` | 월패드 제어용 EW11 IP 주소입니다. |
| `ew11_port` | 월패드 제어용 EW11 포트입니다. 보통 `8899`입니다. |
| `ew11_metering_host` | 검침 전용 EW11 IP 주소입니다. 없으면 비워둡니다. |
| `ew11_metering_port` | 검침 전용 EW11 포트입니다. 보통 `8899`입니다. |
| `elevator_mode` | 엘리베이터 호출 기능 사용 방식입니다. 기본값은 `off`입니다. |
| `elevator_rs485_call_command` | `rs485` 모드에서 보낼 엘리베이터 호출 명령 패킷입니다. |
| `elevator_rs485_call_on_frame` | `rs485` 모드에서 호출 ON 상태로 볼 수신 패킷입니다. |
| `elevator_rs485_calling_frame` | `rs485` 모드에서 호출중 상태로 볼 수신 패킷입니다. |
| `elevator_rs485_released_frame` | `rs485` 모드에서 호출 해제 상태로 볼 수신 패킷입니다. |

예시:

```yaml
mqtt_topic_prefix: "devcommax"
mqtt_broker_url: "192.168.0.34"
mqtt_port: 1883
mqtt_username: "dev"
mqtt_password: "password"

ew11_host: "192.168.0.37"
ew11_port: 8899

ew11_metering_host: ""
ew11_metering_port: 8899
```

엘리베이터 호출 기능은 처음 설치 시 `off`로 비활성화되어 있습니다.

```yaml
elevator_mode: "off"
```

검침 장비가 별도 EW11에 연결되어 있다면:

```yaml
ew11_metering_host: "192.168.0.38"
ew11_metering_port: 8899
```

## 엘리베이터 호출 설정

엘리베이터 호출은 단지마다 구현 방식이 다를 수 있어 기본값은 `off`입니다. 사용 환경에 맞게 `mqtt` 또는 `rs485` 중 하나를 선택해 사용합니다.

### `off` 모드

엘리베이터 기능을 사용하지 않습니다.

```yaml
elevator_mode: "off"
```

이 모드에서는 엘리베이터 스위치 Discovery를 발행하지 않습니다. 이전에 `mqtt` 또는 `rs485` 모드로 생성된 retained Discovery가 남아 있다면 애드온 시작 시 정리합니다.

### `mqtt` 모드

SOAP 또는 별도 TCP/IP 호출 방식으로 엘리베이터를 호출하는 환경에서 사용합니다.

```yaml
elevator_mode: "mqtt"
```

이 모드에서는 애드온이 Home Assistant에 엘리베이터 스위치를 즉시 등록합니다. 사용자가 스위치를 누르면 아래 MQTT 토픽으로 `ON` payload가 발행됩니다.

```text
<mqtt_topic_prefix>/elevator/01/set
```

기본 prefix를 사용할 경우 실제 토픽은 다음과 같습니다.

```text
devcommax/elevator/01/set
```

이 애드온은 `mqtt` 모드에서 RS485 명령을 보내지 않습니다. 위 토픽을 다른 애드온이나 자동화에서 구독한 뒤, 각 세대 환경에 맞는 SOAP 또는 TCP/IP 호출 API를 직접 실행하면 됩니다.

예를 들어 별도 SOAP 호출 애드온은 `devcommax/elevator/01/set` 토픽의 `ON` payload를 받아 엘리베이터 호출 API를 실행하고, 처리 상태를 아래 토픽으로 다시 발행할 수 있습니다.

```text
devcommax/elevator/01/status
```

상태 토픽에는 호출 중이면 `ON`, 호출이 끝났거나 대기 상태이면 `OFF`를 발행하면 Home Assistant 스위치 상태와 맞출 수 있습니다.

`mqtt` 모드에서는 기존 `CommaxEv` SOAP 애드온이 발행하는 `commax/ev` 토픽을 기준으로 엘리베이터 1/2 현재층 센서도 함께 등록합니다.

```json
{"ev1_floor":"▲ 14","ev2_floor":"- 23"}
```

### `rs485` 모드

엘리베이터 호출이 월패드 RS485 신호로 처리되는 환경에서 사용합니다.

```yaml
elevator_mode: "rs485"
elevator_rs485_call_command: "A0 01 01 00 08 D7 00 81"
elevator_rs485_call_on_frame: "22 01 40 07 00 00 00 6A"
elevator_rs485_calling_frame: "26 01 01 42 00 01 05 70"
elevator_rs485_released_frame: "26 01 01 00 00 00 00 28"
```

`rs485` 모드에서는 애드온이 설정된 호출 명령 패킷을 메인 EW11로 직접 전송합니다. 호출 ON, 호출중, 해제 상태 패킷은 각 집 월패드에서 실제로 수신되는 값에 맞게 바꿔 넣을 수 있습니다.

입력하는 패킷은 공백이 있거나 없어도 됩니다. 다만 반드시 8바이트이고 마지막 checksum이 맞아야 합니다. 형식이 틀리거나 checksum이 맞지 않는 값은 시작 로그에 무시 사유를 남기고 사용하지 않습니다.

`rs485` 모드는 설정된 EV 상태 패킷이 실제로 수신된 뒤 엘리베이터 스위치 Discovery를 발행합니다. 아직 패킷이 한 번도 확인되지 않았다면 Home Assistant에 엘리베이터 스위치가 나타나지 않을 수 있습니다.

## 월간 검침 사용량 보정

애드온은 전체 누적 검침값을 받아서 이번 달 사용량을 계산합니다.

월 초부터 애드온을 사용했다면 별도 설정 없이 자동으로 계산됩니다. 월 중간에 처음 설치했다면, 현재까지의 이번 달 사용량을 한 번 입력해 월간 센서를 보정할 수 있습니다.

예를 들어 2026년 4월 25일 기준 이번 달 사용량이 아래와 같다면:

- 전기: `193.0 kWh`
- 수도: `2.3 m³`
- 온수: `1.2 m³`
- 난방: `0.0 m³`

애드온 설정에 이렇게 입력합니다.

```yaml
monthly_metering_usage_period: "2026-04"
monthly_electric_usage: 193.0
monthly_water_usage: 2.3
monthly_warm_usage: 1.2
monthly_heat_usage: 0.0
monthly_gas_usage: null
```

비워둔 항목은 다음 검침 수신 시점부터 자동으로 0부터 계산됩니다.

`monthly_metering_usage_period`가 현재 월과 일치할 때만 보정값이 적용됩니다. 예를 들어 `2026-04`로 입력한 보정값은 2026년 5월이 되면 자동으로 무시됩니다.

월패드 시간 패킷이 수신되면 이번 달 사용량의 월 변경 판단은 월패드 시간을 기준으로 처리합니다. 월패드 시간 패킷이 아직 수신되지 않은 경우에는 애드온이 실행 중인 시스템 시간을 사용합니다.

## EW11 권장 설정

아래 값은 실제 사용 환경에서 안정성과 반응성을 기준으로 맞춘 권장 설정입니다.

### Serial Port Settings

| 항목 | 권장값 |
| --- | --- |
| Baud Rate | `9600` |
| Data Bit | `8` |
| Stop Bit | `1` |
| Parity | `None` |
| Buffer Size | `32` |
| Gap Time | `10` |
| Flow Control | `Disable` |
| CLI | `Serial String` |
| Serial String | `+++` |
| Waiting Time | `300` |
| Protocol | `None` |

EW11 UI에서 Buffer Size와 Gap Time을 더 낮출 수 있다면 낮은 값이 반응성에 유리합니다. 다만 많은 EW11 장비에서 Buffer Size `32`, Gap Time `10`이 최소값입니다.

### Communication Settings

| 항목 | 권장값 |
| --- | --- |
| Protocol | `Tcp Server` |
| Local Port | `8899` |
| Buffer Size | `32` |
| Keep Alive(s) | `60` |
| Timeout(s) | `0` |
| Max Accept | `3` |
| Security | `Disable` |
| Route | `Uart` |

## Home Assistant에 생성되는 항목

MQTT Discovery가 활성화되어 있다면 애드온이 감지한 장치와 센서가 Home Assistant에 자동으로 생성됩니다.

### 제어 장치

- 조명
- 난방
- 환기
- 대기전력 콘센트
- 일괄소등

### 센서

- 실시간 수도 사용량
- 실시간 전기 사용량
- 실시간 온수 사용량
- 실시간 난방 사용량
- 실시간 가스 사용량
- 누적 수도 사용량
- 누적 전기 사용량
- 누적 온수 사용량
- 누적 난방 사용량
- 누적 가스 사용량
- 이번달 수도 사용량
- 이번달 전기 사용량
- 이번달 온수 사용량
- 이번달 난방 사용량
- 이번달 가스 사용량
- 이산화탄소
- 미세먼지
- 초미세먼지
- 주차 위치
- 주차 차량
- 실외 날씨
- 실외 온도
- 실외 습도
- 실외 미세먼지
- 예보 날씨
- 예보 최고 온도
- 예보 최저 온도

생활정보 날씨 센서는 현재 확인된 프레임 기준으로 등록됩니다. `24 01`은 실외 현재 날씨 코드, 습도, 온도이고, `24 02`는 실외 미세먼지(PM10), `25 01`은 예보 날씨 코드와 최고/최저 온도입니다. `8F` 프레임은 날씨 정보가 아닌 것으로 판단되어 날씨 센서 매핑에 사용하지 않습니다.

### 진단 정보

- MQTT 연결 상태
- 메인 EW11 연결 상태
- 검침 EW11 연결 상태
- 월패드 시간
- 메인 EW11 마지막 수신 시간
- 검침 EW11 마지막 수신 시간

월패드 시간과 마지막 수신 시간은 시간이 계속 바뀌는 값이라 활동 로그 증가를 줄이기 위해 기본 비활성 상태로 등록됩니다.

## 로그 확인

애드온 로그에서는 명령 송신, 상태 수신, 응답 시간을 확인할 수 있습니다.

```text
-> 31 04 01 00 00 00 00 36 (조명 04 전원 ON)
<- B1 01 04 00 00 00 00 B6 (조명 04 상태 ON) ACK/STATE 수신 완료 (응답 67ms)
```

명령이 실패하거나 EW11 연결이 끊긴 경우에도 애드온 로그에서 원인을 확인할 수 있습니다.

## 알 수 없는 패킷 수집

월패드 패킷을 추가로 분석하고 싶다면 알 수 없는 패킷 수집 기능을 켤 수 있습니다.

```yaml
unknown_packet_capture_enabled: true
unknown_packet_capture_path: "/share/commax_unknown_packets.jsonl"
```

수집 파일에는 아직 파서가 없는 프레임, 프레이밍 중 버려진 바이트, 미확정 생활정보 `8F` 프레임, 생활정보 `24 01` 실외 현재 날씨 프레임, 생활정보 `24 02` 실외 미세먼지 프레임, 생활정보 `25 01` 예보 프레임이 고유 패킷별로 한 줄씩 저장됩니다. 같은 `source`, `kind`, `hex` 조합의 패킷은 새 줄을 만들지 않고 `count`, `first_seen`, `last_seen`, `seen_at` 수신 시각 배열만 갱신합니다. 날씨와 대기 정보는 센서화된 `24 01`, `24 02`, `25 01` 프레임을 기준으로 확인할 수 있고, `8F`는 남은 의미를 확인하기 위한 미확정 프레임으로만 보존합니다.

## 주의사항

- 동일한 EW11을 사용하는 애드온을 동시에 2개 실행하지 마세요.
- 동일한 MQTT topic prefix를 사용하는 애드온을 동시에 실행하지 마세요.
- 월간 검침 보정값은 현재 월에만 적용되도록 `monthly_metering_usage_period`를 함께 입력하세요.
- 기존에 이미 생성된 MQTT 장치가 있다면, 새 패킷 수신 후 Home Assistant에 아이콘이나 센서 정보가 갱신됩니다.
