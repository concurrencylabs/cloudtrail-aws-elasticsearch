
## Visualize CloudTrail data using Kibana running on AWS Elasticsearch 


Please read <a href="https://www.concurrencylabs.com/blog/auditing-third-parties-using-cloudtrail-elasticsearch/" target="new">this article in the Concurrency Labs blog</a> for more details.



Visualizing CloudTrail logs with Elasticsearch Kibana has been covered in many places,
including the AWS Official Blog. For example, there's <a href="https://aws.amazon.com/blogs/aws/cloudwatch-logs-subscription-consumer-elasticsearch-kibana-dashboards/" target="new">this nice article</a> that
describes a way to create an Elasticsearch cluster and ingest CloudTrail data to it.

### How is this repository different from the many examples out there that send CloudTrail data to Elasticsearch?

The CloudFormation template in this repo uses the AWS Elasticsearch Service instead of using
a self-managed Elasticsearch cluster running on EC2. The AWS Elasticsearch Service was announced in re:Invent 2015.
It also uses a CloudWatch Logs Subscription Filter that has a Lambda function as a target
and it doesn't use Kinesis as a data ingestion mechanism. It also creates an Nginx reverse proxy,
which is the only authorized IP to access the AWS Elasticsearch domain. This proxy is created
in your default VPC, giving you access to the Elasticsearch domain within your VPC.

The data flows in the following sequence: CloudTrail -> CloudWatch Logs -> Subscription Filter ->
Lambda -> AWS Elasticsearch 

![Architecture](https://www.concurrencylabs.com/img/posts/8-cloudtrail-es/cloudcraft-CloudTrail+ES+Proxy.png)




### Artifacts in this repo

**CloudFormation template - cloudtrail-es-cluster.json**

This CloudFormation template creates:

* Multi-region CloudTrail trail
* CloudWatch Logs log group that is the target of CloudTrail data
* S3 Bucket that stores CloudTrail data
* CloudWatch Logs subscription filter
* AWS Lambda function that is target of subscription filter. Sends data to AWS Eleasticsearch
* AWS Elasticsearch domain, target of Lambda function
* Nginx reverse proxy (lives in your default VPC). This is the only authorized IP that can write to the Elasticsearch domain.
* Security Group for the Nginx reverse proxy. You can configure this security group with authorized IPs to access the Nginx proxy on port 80.


**Lambda function code - LogsToElasticsearch.js**

Lambda function code that writes data to AWS Elasticsearch domain.

**Lambda function code - UpdateElasticsearch.js**

Required by CloudFormation during the stack creation. It updates the Elasticsearch cluster
access policy with the IP of the Nginx reverse proxy. It also updates the code of the LogsToElasticsearch
function so it points to the URL of the recently created AWS Elasticsearch cluster. 

This function uses the <a href="https://github.com/daraosn/node-zip" target="new"> node-zip</a> module to generate .zip files that are required by Lambda when setting the function code.
If you really want to modify this function, you would have to instal node-zip and create a deployment package for Lambda.





