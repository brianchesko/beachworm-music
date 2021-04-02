# Generated by Django 3.0.3 on 2021-04-01 02:58

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('mainsite', '0008_merge_20210401_0248'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='song',
            name='artists',
        ),
        migrations.CreateModel(
            name='Artist',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True, null=True, verbose_name='created_time')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='modified_time')),
                ('artist_name', models.TextField()),
                ('song', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='mainsite.Song')),
            ],
            options={
                'abstract': False,
            },
        ),
    ]