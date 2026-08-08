from linkcv.core.config import Settings
from linkcv.core.mq.kafka import KafkaPublisher
from linkcv.core.mq.publisher import MQPublisher
from linkcv.core.mq.rabbitmq import RabbitMQPublisher


def build_mq_publisher(settings: Settings) -> MQPublisher:
    if settings.mq_vendor == "kafka":
        if not settings.kafka_bootstrap_servers:
            raise ValueError("KAFKA_BOOTSTRAP_SERVERS is required")
        return KafkaPublisher(
            bootstrap_servers=settings.kafka_bootstrap_servers,
            topic=settings.kafka_topic,
            confirm_timeout_seconds=settings.mq_publish_confirm_timeout_seconds,
        )

    if settings.rabbitmq_url is None:
        raise ValueError("RABBITMQ_URL is required")
    return RabbitMQPublisher(
        url=settings.rabbitmq_url.get_secret_value(),
        exchange_name=settings.rabbitmq_exchange_name,
        queue_name=settings.rabbitmq_queue,
        routing_key=settings.rabbitmq_routing_key,
        confirm_timeout_seconds=settings.mq_publish_confirm_timeout_seconds,
    )
