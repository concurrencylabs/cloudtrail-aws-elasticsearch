/*
This function completes the configuration of the CloudTrail + Elasticsearch stack.

There are two steps this function executes:

1) Update the AWS Elasticsearch access policy so it accepts requests from the
   IP of the Nginx proxy
2) Update the SubscriptionFilter destination Lambda function with the endpoint
  of the AWS Elasticsearch cluster. The .zip file that is stored in S3 contains
  a placeholder for the Elasticsearch endpoint, therefore we update this value.
*/


var AWS = require('aws-sdk');
var es = new AWS.ES();
var s3 = new AWS.S3();
var lambda = new AWS.Lambda();
var NodeZip = new require('node-zip');
var fs = require("fs");

var responseStatus = "FAILED";
var responseData = {};

/*
This Lambda function is a custom target in the CloudFormation template that creates
an AWS Elasticsearch domain that receives data from CloudTrail through a CloudWatch Logs
subscription. The CW Logs subscription sends CloudTrail data to a Lambda function that
forwards this data to the AWS Elasticsearch domain. The Elasticsearch domain is accessed
using an Nginx reverse proxy.

This Lambda function performs two importan steps:

1) Updates the Elasticsearch domain access policy so that only the Nginx proxy can access it
2) Updates the code of the AWS Lambda function that forwards CloudWatch logs records to 
Elasticsearch. The change consists in updating the Elasticsearch endpoint the Lambda function
writes data to with the actual endpoint that has been created by CloudFormation (this information
is in the event object).
*/


exports.handler = function(event, context) {
	console.log('Event object:['+JSON.stringify(event)+']')
	
	    // For Delete requests, immediately send a SUCCESS response.
    if (event.RequestType == "Delete") {
        sendResponse(event, context, "SUCCESS");
        return;
    }
	
	domainName = event.ResourceProperties.DomainName
	sourceIp = event.ResourceProperties.SourceIp
	

    var accessPolicy = `{                 
          "Version": "2012-10-17",        
	      "Statement": [{
	        "Effect": "Allow",
	        "Principal": {
	          "AWS": "*"
	        },
	        "Action": "es:*",
	        "Resource": "*",
            "Condition": {
              "IpAddress": {
                "aws:SourceIp": "`+ sourceIp +`"
              }
            }	        
	      }]
	    }`;
	    
	params = {
	    DomainName: domainName,
	    AccessPolicies: accessPolicy
	}    

	//1)Update Elasticsearch domain access policy with Nginx reverse proxy IP
    es.updateElasticsearchDomainConfig(params, function(err, data) {
        if (err) {
            responseData = {Error: "UpdateElasticsearchDomainConfig call failed"};
            console.log(responseData.Error + ":\n", err);
            sendResponse(event, context, responseStatus, responseData);

        } else {
            //responseStatus = "SUCCESS";
            responseData = {"sourceIp": sourceIp };
            console.log("UpdateElasticsearchDomainConfig call successful");
            
            //2)Update ES domain endpoint in Lambda function code with the actual ES domain URL
            updateLambdaFunctionCode(event, context, responseStatus, responseData, function(event, context, responseStatus, responseData){
                sendResponse(event, context, responseStatus, responseData);
                
            });
        }        
    });	
};

//Updates the CW Logs->ES Lambda function code with the actual endpoint of the ES cluster
function updateLambdaFunctionCode(event, context, responseStatus, responseData, callback){
    
    lambdaCodeBucket = event.ResourceProperties.LambdaCodeBucket;
	lambdaCodeKey = event.ResourceProperties.LambdaCodeKey;
	lambdaFunctionName = event.ResourceProperties.LambdaFunctionName;
    esClusterEndpoint = event.ResourceProperties.EsClusterEndpoint;
    
    var params = {
      Bucket: lambdaCodeBucket,
      Key: lambdaCodeKey
    };

    console.log('S3.getObject params:['+JSON.stringify(params)+']')
    s3.getObject(params, function(err, data) {
        if (err) {
            responseData = {Error: "UpdateLambdaCode call failed when downloading code from S3"};
            console.log(responseData.Error + ":\n", err);
            callback(event, context, responseStatus, responseData);
        }         
        else {
            var zippedInput = new Buffer(data.Body);
            console.log("Unzipping code file from S3: ["+lambdaCodeBucket+"/"+lambdaCodeKey+"]")
            var unzip = NodeZip(zippedInput, {base64: false, checkCRC32: true});
            console.log("Updating Lambda code...");
            var dezipped = unzip.files['LogsToElasticsearch.js'];
            var updatedLambdaCode = dezipped['_data'].toString('utf8').replace('{es-endpoint}',esClusterEndpoint);
            console.log ("Zipping updated code...");
            var zip = NodeZip();
            zip.file("LogsToElasticsearch.js", updatedLambdaCode);
            var data = zip.generate({base64:false, compression:'DEFLATE'});
            fs.writeFileSync('/tmp/LogsToElasticsearch.zip', data, 'binary');//tried many options, writing to file system is the only one that worked with the JS SDK
                            
            params = {
            	FunctionName: lambdaFunctionName,
                ZipFile: fs.readFileSync('/tmp/LogsToElasticsearch.zip')
            }        
                            
            console.log("Before updating code for Lambda function ["+lambdaFunctionName+"]...")
            lambda.updateFunctionCode(params, function(err, data) {
            	if (err) {
                	responseData = {Error: "UpdateLambdaCode call failed when calling the updateFunctionCode API"};
                    console.log(responseData.Error + ":\n", err);
                }
                else {
                	responseStatus = "SUCCESS";
                    console.log("Successfully updated Lambda code");           // successful response
                }
                callback(event, context, responseStatus, responseData);
            });
        }
    });     
}

// Send response to the pre-signed S3 URL 
function sendResponse(event, context, responseStatus, responseData) {
 
    var responseBody = JSON.stringify({
        Status: responseStatus,
        Reason: "See the details in CloudWatch Log Stream: " + context.logStreamName,
        PhysicalResourceId: context.logStreamName,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: responseData
    });
 
    console.log("RESPONSE BODY:\n", responseBody);
 
    var https = require("https");
    var url = require("url");
 
    var parsedUrl = url.parse(event.ResponseURL);
    var options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.path,
        method: "PUT",
        headers: {
            "content-type": "",
            "content-length": responseBody.length
        }
    };
 
    console.log("SENDING RESPONSE...\n");
 
    var request = https.request(options, function(response) {
        console.log("STATUS: " + response.statusCode);
        console.log("HEADERS: " + JSON.stringify(response.headers));
        // Tell AWS Lambda that the function execution is done  
        context.done();
    });
 
    request.on("error", function(error) {
        console.log("sendResponse Error:" + error);
        // Tell AWS Lambda that the function execution is done  
        context.done();
    });
  
    // write data to request body
    request.write(responseBody);
    request.end();
}